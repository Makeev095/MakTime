import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { logApnsVoipStartup, sendVoipIncomingCall } from './apnsVoip';
import { logApnsAlertStartup, sendChatMessageAlert } from './apnsAlert';
import { logFcmStartup, sendFcmNotification } from './fcmPush';
import { logSmsStartup, sendSmsCode } from './smsProvider';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 10 * 1024 * 1024,
});

const JWT_SECRET = process.env.JWT_SECRET || 'maktime-secret-key-change-in-production';
const PORT = process.env.PORT || 3001;
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const TURN_USER = process.env.TURN_USER || 'maktime';
const TURN_PASS = process.env.TURN_PASS || 'MakTimeT0rn2026!';
const TURN_REALM = process.env.TURN_REALM || 'maktalk.ru';
const TURN_HOST = process.env.TURN_HOST || 'maktalk.ru';
const TURN_PORT = Number(process.env.TURN_PORT || 3478);
const STUN_SERVERS = (process.env.STUN_SERVERS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302,stun:stun2.l.google.com:19302')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const OTP_SECRET = process.env.OTP_SECRET || JWT_SECRET;
const OTP_CODE_TTL_MS = 5 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const SMS_DEBUG_ECHO = process.env.SMS_DEBUG_ECHO === '1' || process.env.SMS_DEBUG_ECHO === 'true';
const onlineUsers = new Map<string, Set<string>>();
const offlineStatusTimers = new Map<string, NodeJS.Timeout>();
const recentSentMessages = new Map<string, { message: any; ts: number }>();
/** Buffer trickle ICE until the peer has registered its WebRTC listeners. */
const pendingIceByPeer = new Map<string, Array<{ from: string; candidate: any; ts: number }>>();
/** Tracks peers that have registered WebRTC listeners (`userId->peerId`). */
const webrtcReadyPeers = new Set<string>();
const OFFLINE_STATUS_DEBOUNCE_MS = 2500;
const PENDING_ICE_TTL_MS = 60_000;

function icePendingKey(receiverId: string, senderId: string) {
  return `${receiverId}<-${senderId}`;
}

function webrtcReadyKey(userId: string, peerId: string) {
  return `${userId}->${peerId}`;
}

function pushPendingIce(receiverId: string, senderId: string, candidate: any) {
  const key = icePendingKey(receiverId, senderId);
  const list = pendingIceByPeer.get(key) || [];
  const now = Date.now();
  list.push({ from: senderId, candidate, ts: now });
  pendingIceByPeer.set(
    key,
    list.filter((item) => now - item.ts < PENDING_ICE_TTL_MS).slice(-64)
  );
}

function flushPendingIce(receiverId: string, senderId: string, emitTo: (payload: { from: string; candidate: any }) => void) {
  const key = icePendingKey(receiverId, senderId);
  const list = pendingIceByPeer.get(key);
  if (!list?.length) return;
  pendingIceByPeer.delete(key);
  list.forEach((item) => emitTo({ from: item.from, candidate: item.candidate }));
}

['images', 'voice', 'files', 'video'].forEach((dir) => {
  fs.mkdirSync(path.join(UPLOADS_DIR, dir), { recursive: true });
});

// --- Security ---
app.set('trust proxy', 1);
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,
}));
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, try again later' },
});
app.use('/api/', apiLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { error: 'Too many auth attempts, try again later' },
});

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Слишком много запросов к SMS-коду, попробуйте позже' },
});

// --- File Upload ---
const storage = multer.diskStorage({
  destination: (_req, file, cb) => {
    let subdir = 'files';
    if (file.mimetype.startsWith('image/')) subdir = 'images';
    else if (file.mimetype.startsWith('video/')) subdir = 'video';
    else if (file.mimetype.startsWith('audio/')) subdir = 'voice';
    cb(null, path.join(UPLOADS_DIR, subdir));
  },
  filename: (_req, _file, cb) => {
    cb(null, `${uuidv4()}${path.extname(_file.originalname) || getExtFromMime(_file.mimetype)}`);
  },
});

function getExtFromMime(mime: string): string {
  const map: Record<string, string> = {
    'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a',
    'audio/mpeg': '.mp3', 'audio/wav': '.wav',
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
    'video/mp4': '.mp4', 'video/webm': '.webm',
  };
  return map[mime] || '';
}

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /^(image|video|audio)\//;
    if (allowed.test(file.mimetype) || file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed'));
    }
  },
});

app.use('/uploads', express.static(UPLOADS_DIR));

// --- Database Setup ---
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'maktime.db');
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    phone_e164 TEXT UNIQUE,
    phone_verified_at TEXT,
    avatar_color TEXT NOT NULL DEFAULT '#6C63FF',
    bio TEXT DEFAULT '',
    status TEXT DEFAULT 'offline',
    last_seen TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS contacts (
    user_id TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, contact_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (contact_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS conversation_participants (
    conversation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    PRIMARY KEY (conversation_id, user_id),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text',
    text TEXT DEFAULT '',
    file_url TEXT,
    file_name TEXT,
    duration REAL,
    reply_to_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    read INTEGER DEFAULT 0,
    deleted INTEGER DEFAULT 0,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id),
    FOREIGN KEY (sender_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_conv_participants ON conversation_participants(user_id);

  CREATE TABLE IF NOT EXISTS user_hidden_conversations (
    user_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    PRIMARY KEY (user_id, conversation_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
  );

  CREATE TABLE IF NOT EXISTS stories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'image',
    file_url TEXT NOT NULL,
    text_overlay TEXT DEFAULT '',
    bg_color TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT DEFAULT (datetime('now', '+24 hours')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS story_views (
    story_id TEXT NOT NULL,
    viewer_id TEXT NOT NULL,
    viewed_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (story_id, viewer_id),
    FOREIGN KEY (story_id) REFERENCES stories(id),
    FOREIGN KEY (viewer_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS story_reactions (
    id TEXT PRIMARY KEY,
    story_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    emoji TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (story_id) REFERENCES stories(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_stories_user ON stories(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_stories_expires ON stories(expires_at);
  CREATE INDEX IF NOT EXISTS idx_story_views ON story_views(story_id);

  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    author_id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'image',
    file_url TEXT NOT NULL,
    caption TEXT DEFAULT '',
    likes_count INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0,
    reposts_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (author_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS post_likes (
    post_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (post_id, user_id),
    FOREIGN KEY (post_id) REFERENCES posts(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS post_comments (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    author_id TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (post_id) REFERENCES posts(id),
    FOREIGN KEY (author_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_post_likes ON post_likes(post_id);
  CREATE INDEX IF NOT EXISTS idx_post_comments ON post_comments(post_id);

  CREATE TABLE IF NOT EXISTS voip_device_tokens (
    user_id TEXT PRIMARY KEY,
    token_hex TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'ios',
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS apns_device_tokens (
    user_id TEXT PRIMARY KEY,
    token_hex TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'ios',
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS fcm_device_tokens (
    user_id TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'android',
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS auth_phone_codes (
    phone_e164 TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    requested_at INTEGER NOT NULL,
    cooldown_until INTEGER NOT NULL
  );
`);

// Migrate existing DB — add columns if missing
const safeAddColumn = (table: string, col: string, type: string, dflt?: string) => {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}${dflt ? ' DEFAULT ' + dflt : ''}`);
  } catch {}
};
safeAddColumn('messages', 'type', 'TEXT', "'text'");
safeAddColumn('messages', 'file_url', 'TEXT', 'NULL');
safeAddColumn('messages', 'file_name', 'TEXT', 'NULL');
safeAddColumn('messages', 'duration', 'REAL', 'NULL');
safeAddColumn('messages', 'reply_to_id', 'TEXT', 'NULL');
safeAddColumn('messages', 'deleted', 'INTEGER', '0');
safeAddColumn('users', 'bio', 'TEXT', "''");
safeAddColumn('users', 'avatar_url', 'TEXT', 'NULL');
safeAddColumn('users', 'phone_e164', 'TEXT', 'NULL');
safeAddColumn('users', 'phone_verified_at', 'TEXT', 'NULL');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_e164 ON users(phone_e164) WHERE phone_e164 IS NOT NULL');

// --- Prepared Statements ---
const stmts = {
  createUser: db.prepare(
    'INSERT INTO users (id, username, display_name, password_hash, avatar_color) VALUES (?, ?, ?, ?, ?)'
  ),
  findUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  findUserByPhone: db.prepare(
    'SELECT * FROM users WHERE phone_e164 = ?'
  ),
  findUserById: db.prepare(
    'SELECT id, username, display_name, avatar_color, avatar_url, bio, status, last_seen, phone_e164, phone_verified_at FROM users WHERE id = ?'
  ),
  searchUsers: db.prepare(
    "SELECT id, username, display_name, avatar_color, avatar_url, status FROM users WHERE (username LIKE ? OR display_name LIKE ?) AND id != ? LIMIT 20"
  ),
  setOnlineStatus: db.prepare("UPDATE users SET status = 'online' WHERE id = ?"),
  setOfflineStatus: db.prepare("UPDATE users SET status = 'offline', last_seen = datetime('now') WHERE id = ?"),
  updateProfile: db.prepare('UPDATE users SET display_name = ?, bio = ?, avatar_url = ? WHERE id = ?'),
  setUserPhone: db.prepare("UPDATE users SET phone_e164 = ?, phone_verified_at = datetime('now') WHERE id = ?"),

  addContact: db.prepare('INSERT OR IGNORE INTO contacts (user_id, contact_id) VALUES (?, ?)'),
  getContacts: db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar_color, u.avatar_url, u.status, u.last_seen
    FROM contacts c JOIN users u ON c.contact_id = u.id
    WHERE c.user_id = ? ORDER BY u.display_name
  `),

  createConversation: db.prepare('INSERT INTO conversations (id) VALUES (?)'),
  addParticipant: db.prepare(
    'INSERT OR IGNORE INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)'
  ),
  findDirectConversation: db.prepare(`
    SELECT cp1.conversation_id FROM conversation_participants cp1
    JOIN conversation_participants cp2 ON cp1.conversation_id = cp2.conversation_id
    WHERE cp1.user_id = ? AND cp2.user_id = ?
  `),
  getUserConversations: db.prepare(`
    SELECT c.id, c.created_at,
      (SELECT m.text FROM messages m WHERE m.conversation_id = c.id AND m.deleted = 0
       ORDER BY m.created_at DESC LIMIT 1) as last_message,
      (SELECT m.type FROM messages m WHERE m.conversation_id = c.id AND m.deleted = 0
       ORDER BY m.created_at DESC LIMIT 1) as last_message_type,
      (SELECT m.created_at FROM messages m WHERE m.conversation_id = c.id AND m.deleted = 0
       ORDER BY m.created_at DESC LIMIT 1) as last_message_time,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.read = 0
       AND m.sender_id != ? AND m.deleted = 0) as unread_count
    FROM conversations c
    JOIN conversation_participants cp ON c.id = cp.conversation_id
    WHERE cp.user_id = ?
      AND NOT EXISTS (SELECT 1 FROM user_hidden_conversations uhc WHERE uhc.user_id = ? AND uhc.conversation_id = c.id)
      AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.deleted = 0)
    ORDER BY last_message_time DESC NULLS LAST
  `),
  hideConversation: db.prepare('INSERT OR IGNORE INTO user_hidden_conversations (user_id, conversation_id) VALUES (?, ?)'),
  unhideConversation: db.prepare('DELETE FROM user_hidden_conversations WHERE user_id = ? AND conversation_id = ?'),
  getConversationParticipants: db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar_color, u.avatar_url, u.status, u.last_seen
    FROM conversation_participants cp JOIN users u ON cp.user_id = u.id
    WHERE cp.conversation_id = ?
  `),

  createMessage: db.prepare(`
    INSERT INTO messages (id, conversation_id, sender_id, type, text, file_url, file_name, duration, reply_to_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getMessages: db.prepare(`
    SELECT * FROM (
      SELECT * FROM messages
      WHERE conversation_id = ? AND deleted = 0
      ORDER BY created_at DESC
      LIMIT 200
    ) recent
    ORDER BY created_at ASC
  `),
  getMessage: db.prepare('SELECT * FROM messages WHERE id = ?'),
  markRead: db.prepare(
    'UPDATE messages SET read = 1 WHERE conversation_id = ? AND sender_id != ? AND read = 0'
  ),
  deleteMessage: db.prepare('UPDATE messages SET deleted = 1 WHERE id = ? AND sender_id = ?'),

  // Stories
  createStory: db.prepare(
    "INSERT INTO stories (id, user_id, type, file_url, text_overlay, bg_color) VALUES (?, ?, ?, ?, ?, ?)"
  ),
  deleteStory: db.prepare('DELETE FROM stories WHERE id = ? AND user_id = ?'),
  getStory: db.prepare('SELECT * FROM stories WHERE id = ?'),
  getUserStories: db.prepare(
    "SELECT * FROM stories WHERE user_id = ? AND expires_at > datetime('now') ORDER BY created_at ASC"
  ),
  getContactStoryUsers: db.prepare(`
    SELECT DISTINCT s.user_id,
      u.username, u.display_name, u.avatar_color, u.avatar_url,
      MAX(s.created_at) as latest_story,
      COUNT(s.id) as story_count
    FROM stories s
    JOIN users u ON s.user_id = u.id
    WHERE s.expires_at > datetime('now')
      AND (s.user_id IN (SELECT contact_id FROM contacts WHERE user_id = ?) OR s.user_id = ?)
    GROUP BY s.user_id
    ORDER BY CASE WHEN s.user_id = ? THEN 0 ELSE 1 END, latest_story DESC
  `),
  getStoriesForUser: db.prepare(
    "SELECT * FROM stories WHERE user_id = ? AND expires_at > datetime('now') ORDER BY created_at ASC"
  ),
  addStoryView: db.prepare('INSERT OR IGNORE INTO story_views (story_id, viewer_id) VALUES (?, ?)'),
  getStoryViewers: db.prepare(`
    SELECT sv.viewed_at, u.id, u.username, u.display_name, u.avatar_color, u.avatar_url
    FROM story_views sv JOIN users u ON sv.viewer_id = u.id
    WHERE sv.story_id = ? ORDER BY sv.viewed_at DESC
  `),
  getStoryViewCount: db.prepare('SELECT COUNT(*) as cnt FROM story_views WHERE story_id = ?'),
  isStoryViewed: db.prepare('SELECT 1 FROM story_views WHERE story_id = ? AND viewer_id = ?'),
  addStoryReaction: db.prepare(
    'INSERT INTO story_reactions (id, story_id, user_id, emoji) VALUES (?, ?, ?, ?)'
  ),
  getStoryReactions: db.prepare(`
    SELECT sr.emoji, sr.created_at, u.id as user_id, u.display_name
    FROM story_reactions sr JOIN users u ON sr.user_id = u.id
    WHERE sr.story_id = ? ORDER BY sr.created_at DESC
  `),
  cleanupExpiredStories: db.prepare("DELETE FROM stories WHERE expires_at <= datetime('now')"),
  cleanupOrphanedViews: db.prepare(
    'DELETE FROM story_views WHERE story_id NOT IN (SELECT id FROM stories)'
  ),
  cleanupOrphanedReactions: db.prepare(
    'DELETE FROM story_reactions WHERE story_id NOT IN (SELECT id FROM stories)'
  ),

  // Posts
  createPost: db.prepare(
    'INSERT INTO posts (id, author_id, type, file_url, caption) VALUES (?, ?, ?, ?, ?)'
  ),
  getPosts: db.prepare(`
    SELECT p.*, u.display_name as author_name, u.avatar_color as author_avatar_color,
      (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id) as likes_count,
      (SELECT COUNT(*) FROM post_comments pc WHERE pc.post_id = p.id) as comments_count,
      0 as reposts_count
    FROM posts p JOIN users u ON p.author_id = u.id
    ORDER BY p.created_at DESC LIMIT ? OFFSET ?
  `),
  getPostsWithLike: db.prepare(`
    SELECT p.*, u.display_name as author_name, u.avatar_color as author_avatar_color,
      (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id) as likes_count,
      (SELECT COUNT(*) FROM post_comments pc WHERE pc.post_id = p.id) as comments_count,
      0 as reposts_count,
      (SELECT 1 FROM post_likes ul WHERE ul.post_id = p.id AND ul.user_id = ?) as is_liked
    FROM posts p JOIN users u ON p.author_id = u.id
    ORDER BY p.created_at DESC LIMIT ? OFFSET ?
  `),
  getPost: db.prepare('SELECT * FROM posts WHERE id = ?'),
  deletePost: db.prepare('DELETE FROM posts WHERE id = ? AND author_id = ?'),
  likePost: db.prepare('INSERT OR IGNORE INTO post_likes (post_id, user_id) VALUES (?, ?)'),
  unlikePost: db.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?'),
  repostPost: db.prepare('UPDATE posts SET reposts_count = reposts_count + 1 WHERE id = ?'),
  getPostComments: db.prepare(`
    SELECT pc.*, u.display_name as author_name, u.avatar_color as author_avatar_color
    FROM post_comments pc JOIN users u ON pc.author_id = u.id
    WHERE pc.post_id = ? ORDER BY pc.created_at ASC
  `),
  addPostComment: db.prepare(
    'INSERT INTO post_comments (id, post_id, author_id, text) VALUES (?, ?, ?, ?)'
  ),

  getVoipToken: db.prepare('SELECT token_hex FROM voip_device_tokens WHERE user_id = ?'),
  getApnsToken: db.prepare('SELECT token_hex FROM apns_device_tokens WHERE user_id = ?'),
  getFcmToken: db.prepare('SELECT token FROM fcm_device_tokens WHERE user_id = ?'),
  upsertPhoneCode: db.prepare(`
    INSERT INTO auth_phone_codes (phone_e164, code_hash, expires_at, attempts, requested_at, cooldown_until)
    VALUES (?, ?, ?, 0, ?, ?)
    ON CONFLICT(phone_e164) DO UPDATE SET
      code_hash = excluded.code_hash,
      expires_at = excluded.expires_at,
      attempts = 0,
      requested_at = excluded.requested_at,
      cooldown_until = excluded.cooldown_until
  `),
  getPhoneCode: db.prepare('SELECT * FROM auth_phone_codes WHERE phone_e164 = ?'),
  incrementPhoneCodeAttempts: db.prepare(
    'UPDATE auth_phone_codes SET attempts = attempts + 1 WHERE phone_e164 = ?'
  ),
  deletePhoneCode: db.prepare('DELETE FROM auth_phone_codes WHERE phone_e164 = ?'),
};

function sanitize(str: string): string {
  return str.replace(/[<>&"']/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#x27;' })[c] || c
  );
}

const CYRILLIC_VISUAL_MAP: Record<string, string> = {
  'а':'a','в':'v','с':'c','е':'e','к':'k','м':'m','н':'n',
  'о':'o','р':'p','т':'t','х':'x','у':'y','А':'A','В':'V',
  'С':'C','Е':'E','К':'K','М':'M','Н':'N','О':'O','Р':'P',
  'Т':'T','Х':'X','У':'Y',
};

const CYRILLIC_PHONETIC_MAP: Record<string, string> = {
  'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i',
  'й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t',
  'у':'u','ф':'f','х':'h','ц':'c','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'',
  'э':'e','ю':'yu','я':'ya',
  'А':'A','Б':'B','В':'V','Г':'G','Д':'D','Е':'E','Ё':'E','Ж':'Zh','З':'Z','И':'I',
  'Й':'Y','К':'K','Л':'L','М':'M','Н':'N','О':'O','П':'P','Р':'R','С':'S','Т':'T',
  'У':'U','Ф':'F','Х':'H','Ц':'C','Ч':'Ch','Ш':'Sh','Щ':'Sch','Ъ':'','Ы':'Y','Ь':'',
  'Э':'E','Ю':'Yu','Я':'Ya',
};

function transliterate(value: string, map: Record<string, string>): string {
  return value.split('').map((ch) => map[ch] ?? ch).join('');
}

function cleanUsernameToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]/g, '');
}

function usernameCandidates(raw: string): string[] {
  const source = raw.trim().replace(/^@+/, '');
  const variants = [
    transliterate(source, CYRILLIC_PHONETIC_MAP),
    transliterate(source, CYRILLIC_VISUAL_MAP),
    source,
  ].map(cleanUsernameToken).filter(Boolean);

  return Array.from(new Set(variants));
}

function canonicalUsername(raw: string): string {
  return usernameCandidates(raw)[0] || '';
}

function normalizePhoneE164(rawPhone: string): string | null {
  const trimmed = rawPhone.trim();
  if (!trimmed) return null;

  const plus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  let normalizedDigits = digits;
  if (digits.length === 11 && digits.startsWith('8')) {
    normalizedDigits = `7${digits.slice(1)}`;
  } else if (!plus && digits.length === 10) {
    normalizedDigits = `7${digits}`;
  }

  if (normalizedDigits.length < 10 || normalizedDigits.length > 15) {
    return null;
  }

  return `+${normalizedDigits}`;
}

function generateOtpCode(): string {
  return String(crypto.randomInt(100000, 1000000));
}

function hashOtpCode(phoneE164: string, code: string): string {
  return crypto
    .createHash('sha256')
    .update(`${OTP_SECRET}:${phoneE164}:${code}`)
    .digest('hex');
}

function makeUsernameFromPhone(phoneE164: string): string {
  const digits = phoneE164.replace(/\D/g, '');
  return `u${digits.slice(-10)}`;
}

function pickRandomAvatarColor(): string {
  const colors = ['#6C63FF', '#FF6584', '#43AA8B', '#F9844A', '#577590', '#F94144', '#90BE6D', '#4ECDC4'];
  return colors[Math.floor(Math.random() * colors.length)];
}

function buildUniqueUsername(base: string): string {
  const cleanedBase = cleanUsernameToken(base).slice(0, 24);
  const start = cleanedBase.length >= 3 ? cleanedBase : `u${Date.now().toString().slice(-6)}`;

  if (!stmts.findUserByUsername.get(start)) {
    return start;
  }

  for (let i = 1; i <= 9999; i += 1) {
    const suffix = `_${i}`;
    const candidate = `${start.slice(0, 24 - suffix.length)}${suffix}`;
    if (!stmts.findUserByUsername.get(candidate)) {
      return candidate;
    }
  }

  return `${start.slice(0, 20)}_${Date.now().toString().slice(-4)}`;
}

function authUserPayload(user: any) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    avatarColor: user.avatar_color,
    avatarUrl: user.avatar_url || null,
    bio: user.bio || '',
    phone: user.phone_e164 || null,
  };
}

function toIsoUtc(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (value.includes('T')) {
    return value.endsWith('Z') ? value : `${value}Z`;
  }
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return `${value.replace(' ', 'T')}Z`;
  }
  return value;
}

function formatMessage(m: any) {
  return {
    id: m.id,
    conversationId: m.conversation_id,
    senderId: m.sender_id,
    type: m.type || 'text',
    text: m.text || '',
    fileUrl: m.file_url || null,
    fileName: m.file_name || null,
    duration: m.duration || null,
    replyToId: m.reply_to_id || null,
    createdAt: toIsoUtc(m.created_at) || new Date().toISOString(),
    read: !!m.read,
  };
}

function resolveTurnHost(req: express.Request): string {
  if (TURN_HOST) return TURN_HOST;
  const forwardedHost = req.headers['x-forwarded-host'];
  const rawHost = typeof forwardedHost === 'string'
    ? forwardedHost.split(',')[0].trim()
    : req.get('host') || req.hostname || '';
  return rawHost.replace(/:\d+$/, '') || TURN_REALM;
}

/** Текст для APNs (как превью в списке чатов на клиенте). */
function chatPushPreview(type: string, text: string): string {
  switch (type) {
    case 'voice':
      return '🎤 Голосовое сообщение';
    case 'image':
      return '📷 Фото';
    case 'video':
      return '🎥 Видео';
    case 'videoNote':
      return '📹 Видеосообщение';
    case 'file':
      return '📎 Файл';
    default:
      break;
  }
  const t = (text || '').trim();
  if (!t) return 'Новое сообщение';
  return t.length > 160 ? `${t.slice(0, 157)}…` : t;
}

function userRoom(userId: string): string {
  return `user:${userId}`;
}

function getOnlineSocketIds(userId: string): string[] {
  return Array.from(onlineUsers.get(userId) || []);
}

function isUserOnline(userId: string): boolean {
  return getOnlineSocketIds(userId).length > 0;
}

function markSocketOnline(userId: string, socketId: string): boolean {
  const existing = onlineUsers.get(userId);
  const sockets = existing ?? new Set<string>();
  const wasOffline = sockets.size === 0;
  sockets.add(socketId);
  onlineUsers.set(userId, sockets);
  return wasOffline;
}

function markSocketOffline(userId: string, socketId: string): boolean {
  const sockets = onlineUsers.get(userId);
  if (!sockets) return true;
  sockets.delete(socketId);
  if (sockets.size === 0) {
    onlineUsers.delete(userId);
    return true;
  }
  return false;
}

function emitUserStatus(userId: string, status: 'online' | 'offline') {
  const row = stmts.findUserById.get(userId) as { last_seen?: string | null } | undefined;
  io.emit('user:status', {
    userId,
    status,
    lastSeen: toIsoUtc(row?.last_seen) || null,
  });
}

function ensureUserSocketsInConversation(userId: string, conversationId: string): string[] {
  const socketIds = getOnlineSocketIds(userId);
  const joinedNow: string[] = [];

  socketIds.forEach((sid) => {
    const targetSocket = io.sockets.sockets.get(sid);
    if (!targetSocket) return;
    if (targetSocket.rooms.has(conversationId)) {
      return;
    }
    targetSocket.join(conversationId);
    joinedNow.push(sid);
  });

  return joinedNow;
}

async function sendOfflineMessageNotifications(
  receiverId: string,
  conversationId: string,
  title: string,
  body: string
) {
  const apnsRow = stmts.getApnsToken.get(receiverId) as { token_hex: string } | undefined;
  const fcmRow = stmts.getFcmToken.get(receiverId) as { token: string } | undefined;

  await Promise.allSettled([
    sendChatMessageAlert(apnsRow?.token_hex, { conversationId, title, body }),
    sendFcmNotification(fcmRow?.token, {
      title,
      body,
      data: {
        type: 'message',
        conversationId,
      },
    }),
  ]);
}

async function sendOfflineCallNotifications(args: {
  receiverId: string;
  conversationId: string;
  callerId: string;
  callerName: string;
}) {
  const voipRow = stmts.getVoipToken.get(args.receiverId) as { token_hex: string } | undefined;
  const apnsRow = stmts.getApnsToken.get(args.receiverId) as { token_hex: string } | undefined;
  const fcmRow = stmts.getFcmToken.get(args.receiverId) as { token: string } | undefined;

  const callUUID = uuidv4();
  const [voipResult, apnsResult, fcmResult] = await Promise.all([
    sendVoipIncomingCall(voipRow?.token_hex, {
      callUUID,
      from: args.callerId,
      callerName: args.callerName,
      conversationId: args.conversationId,
    }),
    sendChatMessageAlert(apnsRow?.token_hex, {
      conversationId: args.conversationId,
      title: args.callerName || 'MakTalk',
      body: 'Входящий видеозвонок',
    }),
    sendFcmNotification(fcmRow?.token, {
      title: args.callerName || 'MakTalk',
      body: 'Входящий видеозвонок',
      data: {
        type: 'call',
        conversationId: args.conversationId,
        from: args.callerId,
        callerName: args.callerName,
        callUUID,
      },
    }),
  ]);

  return {
    ok: voipResult.ok || apnsResult.ok || fcmResult.ok,
  };
}

type MessageSendPayload = {
  conversationId: string;
  text?: string;
  type?: string;
  fileUrl?: string;
  fileName?: string;
  duration?: number;
  replyToId?: string;
  clientMessageId?: string;
};

function makeHttpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

function cleanupRecentMessages() {
  const now = Date.now();
  if (recentSentMessages.size <= 2000) return;
  for (const [key, value] of recentSentMessages.entries()) {
    if (now - value.ts > 10 * 60 * 1000) {
      recentSentMessages.delete(key);
    }
  }
}

function createAndBroadcastMessage(userId: string, data: MessageSendPayload) {
  cleanupRecentMessages();

  if (!data.conversationId) {
    throw makeHttpError(400, 'conversationId required');
  }

  const dedupeKey = data.clientMessageId ? `${userId}:${data.clientMessageId}` : '';
  if (dedupeKey) {
    const existing = recentSentMessages.get(dedupeKey);
    if (existing) return existing.message;
  }

  const participants = stmts.getConversationParticipants.all(data.conversationId) as any[];
  if (!participants.some((p) => p.id === userId)) {
    throw makeHttpError(403, 'Нет доступа к чату');
  }
  if (data.fileUrl && !data.fileUrl.startsWith('/uploads/')) {
    throw makeHttpError(400, 'Некорректный файл');
  }

  const msgId = uuidv4();
  const type = data.type || (data.fileUrl ? 'file' : 'text');
  const text = data.text ? sanitize(data.text) : '';
  if (type === 'text' && !text.trim() && !data.fileUrl) {
    throw makeHttpError(400, 'Пустое сообщение');
  }

  stmts.createMessage.run(
    msgId, data.conversationId, userId, type, text,
    data.fileUrl || null, data.fileName || null,
    data.duration || null, data.replyToId || null
  );

  const message = {
    id: msgId,
    conversationId: data.conversationId,
    senderId: userId,
    type,
    text,
    fileUrl: data.fileUrl || null,
    fileName: data.fileName || null,
    duration: data.duration || null,
    replyToId: data.replyToId || null,
    createdAt: new Date().toISOString(),
    read: false,
  };

  io.to(data.conversationId).emit('message:new', message);

  const msgCount = (db.prepare(
    'SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ? AND deleted = 0'
  ).get(data.conversationId) as any).cnt;

  // New messages should bring the chat back for every participant (e.g. after
  // hide/delete locally, or after reinstall when the peer kept messaging).
  participants.forEach((p) => {
    stmts.unhideConversation.run(p.id, data.conversationId);
  });

  participants.forEach((p) => {
    if (p.id !== userId) {
      if (isUserOnline(p.id)) {
        const joinedNow = ensureUserSocketsInConversation(p.id, data.conversationId);
        joinedNow.forEach((sid) => {
          io.to(sid).emit('message:new', message);
        });
        io.to(userRoom(p.id)).emit('conversation:updated', { id: data.conversationId });
        if (msgCount === 1) {
          io.to(userRoom(p.id)).emit('conversation:created', { id: data.conversationId });
        }
      }
    } else {
      io.to(userRoom(p.id)).emit('conversation:updated', { id: data.conversationId });
    }
  });

  const senderRow = stmts.findUserById.get(userId) as { display_name?: string } | undefined;
  const senderTitle = ((senderRow?.display_name ?? '') as string).trim() || 'MakTime';
  const alertBody = chatPushPreview(type, text);
  participants.forEach((p) => {
    if (p.id === userId) return;
    if (isUserOnline(p.id)) return;
    void sendOfflineMessageNotifications(p.id, data.conversationId, senderTitle, alertBody);
  });

  if (dedupeKey) {
    recentSentMessages.set(dedupeKey, { message, ts: Date.now() });
  }

  return message;
}

// --- Auth Middleware ---
function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    (req as any).userId = decoded.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// --- Auth Routes ---
app.post('/api/auth/register', authLimiter, (req, res) => {
  try {
    const { username, displayName, password } = req.body;
    if (!username || !password || !displayName) {
      return res.status(400).json({ error: 'Все поля обязательны' });
    }
    if (String(password).length < 6) return res.status(400).json({ error: 'Минимум 6 символов для пароля' });

    const clean = canonicalUsername(String(username));
    if (clean.length < 3) {
      return res.status(400).json({ error: 'Минимум 3 символа (латиница, цифры, _)' });
    }

    const existing = stmts.findUserByUsername.get(clean);
    if (existing) return res.status(409).json({ error: 'Имя занято' });

    const id = uuidv4();
    const hash = bcrypt.hashSync(password, 12);
    const color = pickRandomAvatarColor();

    stmts.createUser.run(id, clean, sanitize(displayName), hash, color);
    const created = stmts.findUserById.get(id) as any;

    const token = jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
      token,
      user: authUserPayload(created),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Введите имя и пароль' });
    const candidates = usernameCandidates(String(username));
    const user = candidates
      .map((candidate) => stmts.findUserByUsername.get(candidate) as any)
      .find(Boolean);
    if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
      return res.status(401).json({ error: 'Неверные данные' });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
      token,
      user: authUserPayload(user),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = stmts.findUserById.get((req as any).userId) as any;
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(authUserPayload(user));
});

app.post('/api/auth/phone/request', otpLimiter, async (req, res) => {
  try {
    const rawPhone = String(req.body?.phone || '');
    const phoneE164 = normalizePhoneE164(rawPhone);
    if (!phoneE164) {
      return res.status(400).json({ error: 'Некорректный номер телефона' });
    }

    const now = Date.now();
    const existing = stmts.getPhoneCode.get(phoneE164) as
      | { cooldown_until: number; expires_at: number }
      | undefined;
    if (existing?.cooldown_until && existing.cooldown_until > now) {
      return res.status(429).json({
        error: 'Код уже отправлен, попробуйте позже',
        retryAfterSec: Math.ceil((existing.cooldown_until - now) / 1000),
      });
    }

    const code = generateOtpCode();
    const codeHash = hashOtpCode(phoneE164, code);
    const expiresAt = now + OTP_CODE_TTL_MS;
    const cooldownUntil = now + OTP_RESEND_COOLDOWN_MS;
    stmts.upsertPhoneCode.run(phoneE164, codeHash, expiresAt, now, cooldownUntil);

    const sendResult = await sendSmsCode(phoneE164, code);
    if (!sendResult.ok) {
      console.warn('[SMS] OTP send failed:', sendResult.error);
      return res.status(502).json({ error: 'Не удалось отправить SMS-код' });
    }

    const response: Record<string, unknown> = {
      ok: true,
      retryAfterSec: Math.round(OTP_RESEND_COOLDOWN_MS / 1000),
      expiresInSec: Math.round(OTP_CODE_TTL_MS / 1000),
    };
    if (SMS_DEBUG_ECHO) {
      response.debugCode = code;
    }
    res.json(response);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/phone/verify', otpLimiter, (req, res) => {
  try {
    const phoneE164 = normalizePhoneE164(String(req.body?.phone || ''));
    const code = String(req.body?.code || '').replace(/\D/g, '').slice(0, 6);
    const displayNameRaw = String(req.body?.displayName || '').trim();

    if (!phoneE164) return res.status(400).json({ error: 'Некорректный номер телефона' });
    if (code.length < 4) return res.status(400).json({ error: 'Некорректный код' });

    const row = stmts.getPhoneCode.get(phoneE164) as
      | { code_hash: string; expires_at: number; attempts: number }
      | undefined;
    if (!row) return res.status(400).json({ error: 'Сначала запросите SMS-код' });

    const now = Date.now();
    if (row.expires_at <= now) {
      stmts.deletePhoneCode.run(phoneE164);
      return res.status(400).json({ error: 'Код истёк, запросите новый' });
    }
    if (row.attempts >= OTP_MAX_ATTEMPTS) {
      stmts.deletePhoneCode.run(phoneE164);
      return res.status(429).json({ error: 'Слишком много попыток, запросите новый код' });
    }

    const expectedHash = hashOtpCode(phoneE164, code);
    if (expectedHash !== row.code_hash) {
      stmts.incrementPhoneCodeAttempts.run(phoneE164);
      const attemptsLeft = Math.max(0, OTP_MAX_ATTEMPTS - (row.attempts + 1));
      if (attemptsLeft <= 0) {
        stmts.deletePhoneCode.run(phoneE164);
      }
      return res.status(401).json({
        error: attemptsLeft > 0 ? 'Неверный код' : 'Слишком много попыток, запросите новый код',
        attemptsLeft,
      });
    }

    stmts.deletePhoneCode.run(phoneE164);

    let user = stmts.findUserByPhone.get(phoneE164) as any;
    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      const id = uuidv4();
      const username = buildUniqueUsername(makeUsernameFromPhone(phoneE164));
      const displayName = sanitize(displayNameRaw || `Пользователь ${phoneE164.slice(-4)}`);
      const passwordHash = bcrypt.hashSync(uuidv4(), 12);
      const color = pickRandomAvatarColor();

      stmts.createUser.run(id, username, displayName, passwordHash, color);
      stmts.setUserPhone.run(phoneE164, id);
      user = stmts.findUserById.get(id) as any;
    } else if (!user.phone_e164) {
      stmts.setUserPhone.run(phoneE164, user.id);
      user = stmts.findUserById.get(user.id) as any;
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
      token,
      user: authUserPayload(user),
      isNewUser,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/webrtc/config', authMiddleware, (req, res) => {
  const turnHost = resolveTurnHost(req);
  const iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [
    { urls: STUN_SERVERS },
  ];

  if (TURN_USER && TURN_PASS && turnHost) {
    iceServers.push(
      { urls: `turn:${turnHost}:${TURN_PORT}`, username: TURN_USER, credential: TURN_PASS },
      { urls: `turn:${turnHost}:${TURN_PORT}?transport=tcp`, username: TURN_USER, credential: TURN_PASS }
    );
  }

  res.json({
    iceServers,
    turn: {
      host: turnHost,
      port: TURN_PORT,
      realm: TURN_REALM,
    },
  });
});

// VoIP device token (iOS PushKit) — одна запись на пользователя, последний токен перезаписывает предыдущий
app.post('/api/devices/voip-token', authMiddleware, (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const { token, platform } = req.body as { token?: string; platform?: string };
    if (!token || typeof token !== 'string' || token.length < 16) {
      return res.status(400).json({ error: 'token required (hex from APNs)' });
    }
    const plat = typeof platform === 'string' && platform ? platform : 'ios';
    db.prepare(
      `INSERT INTO voip_device_tokens (user_id, token_hex, platform, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         token_hex = excluded.token_hex,
         platform = excluded.platform,
         updated_at = datetime('now')`
    ).run(userId, token.toLowerCase(), plat);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** APNs device token для обычных уведомлений о сообщениях (не PushKit). Отдельный токен от VoIP. */
app.post('/api/devices/apns-token', authMiddleware, (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const { token, platform } = req.body as { token?: string; platform?: string };
    if (!token || typeof token !== 'string' || token.length < 16) {
      return res.status(400).json({ error: 'token required (hex from APNs)' });
    }
    const plat = typeof platform === 'string' && platform ? platform : 'ios';
    db.prepare(
      `INSERT INTO apns_device_tokens (user_id, token_hex, platform, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         token_hex = excluded.token_hex,
         platform = excluded.platform,
         updated_at = datetime('now')`
    ).run(userId, token.toLowerCase(), plat);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/devices/fcm-token', authMiddleware, (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const { token, platform } = req.body as { token?: string; platform?: string };
    if (!token || typeof token !== 'string' || token.length < 16) {
      return res.status(400).json({ error: 'token required (fcm)' });
    }
    const plat = typeof platform === 'string' && platform ? platform : 'android';
    db.prepare(
      `INSERT INTO fcm_device_tokens (user_id, token, platform, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         token = excluded.token,
         platform = excluded.platform,
         updated_at = datetime('now')`
    ).run(userId, token, plat);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/auth/profile', authMiddleware, (req, res) => {
  const { displayName, bio, avatarUrl } = req.body;
  const userId = (req as any).userId;
  const url = avatarUrl && typeof avatarUrl === 'string' && avatarUrl.startsWith('/uploads/') ? avatarUrl : null;
  stmts.updateProfile.run(sanitize(displayName || ''), sanitize(bio || ''), url, userId);
  const user = stmts.findUserById.get(userId) as any;
  res.json(authUserPayload(user));
});

// --- Search & Contacts ---
app.get('/api/users/search', authMiddleware, (req, res) => {
  const query = (req.query.q as string || '').trim();
  if (query.length < 2) return res.json([]);
  const userId = (req as any).userId;
  const lower = query.toLowerCase();

  const users = db.prepare(
    'SELECT id, username, display_name, avatar_color, avatar_url, status FROM users WHERE id != ? LIMIT 500'
  ).all(userId) as any[];

  const filtered = users.filter((u) =>
    u.username.includes(lower) || u.display_name.toLowerCase().includes(lower)
  ).slice(0, 20);

  res.json(
    filtered.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.display_name,
      avatarColor: u.avatar_color,
      avatarUrl: u.avatar_url || null,
      status: u.status,
    }))
  );
});

app.post('/api/contacts/:contactId', authMiddleware, (req, res) => {
  const userId = (req as any).userId;
  const { contactId } = req.params;
  const contactUser = stmts.findUserById.get(contactId);
  if (!contactUser) return res.status(404).json({ error: 'User not found' });
  stmts.addContact.run(userId, contactId);
  stmts.addContact.run(contactId, userId);
  res.json({ success: true });
});

app.get('/api/contacts', authMiddleware, (req, res) => {
  const contacts = stmts.getContacts.all((req as any).userId) as any[];
  res.json(
    contacts.map((c) => ({
      id: c.id,
      username: c.username,
      displayName: c.display_name,
      avatarColor: c.avatar_color,
      avatarUrl: c.avatar_url || null,
      status: c.status,
      lastSeen: toIsoUtc(c.last_seen),
    }))
  );
});

// --- Conversations ---
app.get('/api/conversations', authMiddleware, (req, res) => {
  const userId = (req as any).userId;
  const conversations = stmts.getUserConversations.all(userId, userId, userId) as any[];
  const result = conversations.map((conv) => {
    const participants = stmts.getConversationParticipants.all(conv.id) as any[];
    const other = participants.find((p: any) => p.id !== userId);
    return {
      id: conv.id,
      lastMessage: conv.last_message,
      lastMessageType: conv.last_message_type || 'text',
      lastMessageTime: toIsoUtc(conv.last_message_time),
      unreadCount: conv.unread_count,
      participant: other
        ? {
            id: other.id,
            username: other.username,
            displayName: other.display_name,
            avatarColor: other.avatar_color,
            avatarUrl: other.avatar_url || null,
            status: other.status,
            lastSeen: toIsoUtc(other.last_seen),
          }
        : null,
    };
  });
  res.json(result);
});

app.post('/api/conversations', authMiddleware, (req, res) => {
  const userId = (req as any).userId;
  const { participantId } = req.body;

  const existing = stmts.findDirectConversation.get(userId, participantId) as any;
  if (existing) {
    stmts.unhideConversation.run(userId, existing.conversation_id);
    return res.json({ id: existing.conversation_id, existing: true });
  }

  const id = uuidv4();
  stmts.createConversation.run(id);
  stmts.addParticipant.run(id, userId);
  stmts.addParticipant.run(id, participantId);

  res.json({ id, existing: false });
});

app.delete('/api/conversations/:id', authMiddleware, (req, res) => {
  const userId = (req as any).userId;
  const conversationId = req.params.id;
  const participants = stmts.getConversationParticipants.all(conversationId) as any[];
  const isParticipant = participants.some((p: any) => p.id === userId);
  if (!isParticipant) return res.status(404).json({ error: 'Чат не найден' });
  stmts.hideConversation.run(userId, conversationId);
  res.json({ ok: true });
});

app.get('/api/conversations/:id/messages', authMiddleware, (req, res) => {
  const userId = (req as any).userId;
  const conversationId = req.params.id;
  const participants = stmts.getConversationParticipants.all(conversationId) as any[];
  if (!participants.some((p: any) => p.id === userId)) {
    return res.status(403).json({ error: 'Нет доступа к чату' });
  }
  // Opening a chat restores it in the list after hide/reinstall.
  stmts.unhideConversation.run(userId, conversationId);
  const messages = stmts.getMessages.all(conversationId) as any[];
  const markResult = stmts.markRead.run(conversationId, userId) as { changes?: number };
  if ((markResult.changes || 0) > 0) {
    io.to(conversationId).emit('message:read', {
      conversationId,
      readBy: userId,
    });
  }
  res.json(messages.map(formatMessage));
});

app.post('/api/conversations/:id/messages', authMiddleware, (req, res) => {
  const userId = (req as any).userId as string;
  const conversationId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const {
    text, type, fileUrl, fileName, duration, replyToId, clientMessageId,
  } = req.body || {};

  try {
    const message = createAndBroadcastMessage(userId, {
      conversationId,
      text: typeof text === 'string' ? text : '',
      type: typeof type === 'string' ? type : undefined,
      fileUrl: typeof fileUrl === 'string' ? fileUrl : undefined,
      fileName: typeof fileName === 'string' ? fileName : undefined,
      duration: typeof duration === 'number' ? duration : undefined,
      replyToId: typeof replyToId === 'string' ? replyToId : undefined,
      clientMessageId: typeof clientMessageId === 'string' ? clientMessageId : undefined,
    });
    res.json(message);
  } catch (error: any) {
    const status = error?.status || 500;
    res.status(status).json({ error: error?.message || 'Ошибка отправки' });
  }
});

app.delete('/api/messages/:id', authMiddleware, (req, res) => {
  const userId = (req as any).userId;
  const msg = stmts.getMessage.get(req.params.id) as any;
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  if (msg.sender_id !== userId) return res.status(403).json({ error: 'Forbidden' });
  stmts.deleteMessage.run(req.params.id, userId);
  io.to(msg.conversation_id).emit('message:deleted', {
    messageId: req.params.id,
    conversationId: msg.conversation_id,
  });
  res.json({ success: true });
});

// --- File Upload ---
app.post('/api/upload', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const subdir = req.file.destination.split(path.sep).pop();
  const fileUrl = `/uploads/${subdir}/${req.file.filename}`;
  res.json({
    fileUrl,
    fileName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
  });
});

// --- Stories ---
app.post('/api/stories', authMiddleware, (req, res) => {
  try {
    const userId = (req as any).userId;
    const { type, fileUrl, textOverlay, bgColor } = req.body;
    if (!fileUrl) return res.status(400).json({ error: 'File URL required' });
    if (!fileUrl.startsWith('/uploads/')) return res.status(400).json({ error: 'Invalid file URL' });

    const id = uuidv4();
    const storyType = type === 'video' ? 'video' : 'image';
    stmts.createStory.run(id, userId, storyType, fileUrl, sanitize(textOverlay || ''), bgColor || '');

    const user = stmts.findUserById.get(userId) as any;
    io.emit('story:new', {
      storyId: id,
      userId,
      username: user.username,
      displayName: user.display_name,
      avatarColor: user.avatar_color,
    });

    res.json({ id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stories', authMiddleware, (req, res) => {
  const userId = (req as any).userId;
  const storyUsers = stmts.getContactStoryUsers.all(userId, userId, userId) as any[];

  const result = storyUsers.map((su) => {
    const stories = stmts.getStoriesForUser.all(su.user_id) as any[];
    const hasUnviewed = stories.some((s) => !stmts.isStoryViewed.get(s.id, userId));
    return {
      userId: su.user_id,
      username: su.username,
      displayName: su.display_name,
      avatarColor: su.avatar_color,
      avatarUrl: su.avatar_url || null,
      storyCount: su.story_count,
      hasUnviewed,
      isOwn: su.user_id === userId,
      stories: stories.map((s) => ({
        id: s.id,
        type: s.type,
        fileUrl: s.file_url,
        textOverlay: s.text_overlay || '',
        bgColor: s.bg_color || '',
        createdAt: s.created_at,
        expiresAt: s.expires_at,
        viewed: !!stmts.isStoryViewed.get(s.id, userId),
        viewCount: (stmts.getStoryViewCount.get(s.id) as any)?.cnt || 0,
      })),
    };
  });

  res.json(result);
});

app.post('/api/stories/:storyId/view', authMiddleware, (req, res) => {
  const userId = (req as any).userId;
  const { storyId } = req.params;
  const story = stmts.getStory.get(storyId) as any;
  if (!story) return res.status(404).json({ error: 'Story not found' });
  if (story.user_id !== userId) {
    stmts.addStoryView.run(storyId, userId);
  }
  res.json({ success: true });
});

app.get('/api/stories/:storyId/viewers', authMiddleware, (req, res) => {
  const userId = (req as any).userId;
  const { storyId } = req.params;
  const story = stmts.getStory.get(storyId) as any;
  if (!story) return res.status(404).json({ error: 'Story not found' });
  if (story.user_id !== userId) return res.status(403).json({ error: 'Only owner can see viewers' });

  const viewers = stmts.getStoryViewers.all(storyId) as any[];
  res.json(viewers.map((v) => ({
    userId: v.id,
    displayName: v.display_name,
    avatarColor: v.avatar_color,
    avatarUrl: v.avatar_url || null,
    viewedAt: v.viewed_at,
  })));
});

app.post('/api/stories/:storyId/react', authMiddleware, (req, res) => {
  const userId = (req as any).userId;
  const { storyId } = req.params;
  const { emoji } = req.body;
  if (!emoji) return res.status(400).json({ error: 'Emoji required' });

  const story = stmts.getStory.get(storyId) as any;
  if (!story) return res.status(404).json({ error: 'Story not found' });

  const id = uuidv4();
  stmts.addStoryReaction.run(id, storyId, userId, emoji);

  const reactor = stmts.findUserById.get(userId) as any;
  if (isUserOnline(story.user_id)) {
    io.to(userRoom(story.user_id)).emit('story:reaction', {
      storyId,
      emoji,
      userId,
      displayName: reactor.display_name,
    });
  }

  res.json({ success: true });
});

app.delete('/api/stories/:storyId', authMiddleware, (req, res) => {
  const userId = (req as any).userId;
  stmts.deleteStory.run(req.params.storyId, userId);
  res.json({ success: true });
});

app.get('/api/stories/:storyId/reactions', authMiddleware, (req, res) => {
  const reactions = stmts.getStoryReactions.all(req.params.storyId) as any[];
  res.json(reactions.map((r) => ({
    emoji: r.emoji,
    userId: r.user_id,
    displayName: r.display_name,
    createdAt: r.created_at,
  })));
});

// Cleanup expired stories every 10 minutes
setInterval(() => {
  try {
    stmts.cleanupExpiredStories.run();
    stmts.cleanupOrphanedViews.run();
    stmts.cleanupOrphanedReactions.run();
  } catch {}
}, 10 * 60 * 1000);

// --- Posts API ---
app.get('/api/posts', authMiddleware, (req, res) => {
  const userId = (req as any).userId;
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const offset = Number(req.query.offset) || 0;
  const rows = stmts.getPostsWithLike.all(userId, limit, offset) as any[];
  res.json(rows.map((p) => ({
    id: p.id,
    authorId: p.author_id,
    authorName: p.author_name,
    authorAvatarColor: p.author_avatar_color,
    type: p.type,
    fileUrl: p.file_url,
    caption: p.caption || '',
    likesCount: p.likes_count || 0,
    commentsCount: p.comments_count || 0,
    repostsCount: p.reposts_count || 0,
    isLiked: !!p.is_liked,
    createdAt: p.created_at,
  })));
});

app.post('/api/posts', authMiddleware, (req, res) => {
  const userId = (req as any).userId;
  const { type, fileUrl, caption } = req.body;
  if (!fileUrl) return res.status(400).json({ error: 'fileUrl required' });
  if (fileUrl && !fileUrl.startsWith('/uploads/')) {
    return res.status(400).json({ error: 'Invalid file URL' });
  }
  const id = uuidv4();
  stmts.createPost.run(id, userId, type || 'image', fileUrl, sanitize(caption || ''));
  const user = stmts.findUserById.get(userId) as any;
  res.json({
    id,
    authorId: userId,
    authorName: user?.display_name || '',
    authorAvatarColor: user?.avatar_color || '#6C63FF',
    type: type || 'image',
    fileUrl,
    caption: sanitize(caption || ''),
    likesCount: 0,
    commentsCount: 0,
    repostsCount: 0,
    isLiked: false,
    createdAt: new Date().toISOString(),
  });
});

app.post('/api/posts/:postId/like', authMiddleware, (req, res) => {
  const userId = (req as any).userId;
  stmts.likePost.run(req.params.postId, userId);
  res.json({ ok: true });
});

app.delete('/api/posts/:postId/like', authMiddleware, (req, res) => {
  const userId = (req as any).userId;
  stmts.unlikePost.run(req.params.postId, userId);
  res.json({ ok: true });
});

app.post('/api/posts/:postId/repost', authMiddleware, (req, res) => {
  stmts.repostPost.run(req.params.postId);
  res.json({ ok: true });
});

app.delete('/api/posts/:postId', authMiddleware, (req, res) => {
  try {
    const userId = (req as any).userId;
    const postId = req.params.postId;
    const post = stmts.getPost.get(postId) as any;
    if (!post) return res.status(404).json({ error: 'Пост не найден' });
    if (post.author_id !== userId) return res.status(403).json({ error: 'Нет прав на удаление' });
    db.prepare('DELETE FROM post_comments WHERE post_id = ?').run(postId);
    db.prepare('DELETE FROM post_likes WHERE post_id = ?').run(postId);
    stmts.deletePost.run(postId, userId);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Ошибка удаления' });
  }
});

app.get('/api/posts/:postId/comments', authMiddleware, (req, res) => {
  const rows = stmts.getPostComments.all(req.params.postId) as any[];
  res.json(rows.map((c) => ({
    id: c.id,
    authorId: c.author_id,
    authorName: c.author_name,
    authorAvatarColor: c.author_avatar_color,
    text: c.text,
    createdAt: c.created_at,
  })));
});

app.post('/api/posts/:postId/comments', authMiddleware, (req, res) => {
  const userId = (req as any).userId;
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'text required' });
  const id = uuidv4();
  stmts.addPostComment.run(id, req.params.postId, userId, sanitize(text.trim()));
  const user = stmts.findUserById.get(userId) as any;
  res.json({
    id,
    authorId: userId,
    authorName: user?.display_name || '',
    authorAvatarColor: user?.avatar_color || '#6C63FF',
    text: sanitize(text.trim()),
    createdAt: new Date().toISOString(),
  });
});

// --- Socket.IO ---
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || (socket.handshake.query?.token as string);
  if (!token) return next(new Error('Authentication required'));
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    (socket as any).userId = decoded.userId;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  const userId = (socket as any).userId;
  socket.join(userRoom(userId));
  const offlineTimer = offlineStatusTimers.get(userId);
  if (offlineTimer) {
    clearTimeout(offlineTimer);
    offlineStatusTimers.delete(userId);
  }
  const becameOnline = markSocketOnline(userId, socket.id);
  if (becameOnline) {
    stmts.setOnlineStatus.run(userId);
    emitUserStatus(userId, 'online');
  }

  const allRooms = db.prepare(
    'SELECT conversation_id FROM conversation_participants WHERE user_id = ?'
  ).all(userId) as any[];
  allRooms.forEach((c: any) => socket.join(c.conversation_id));

  // --- Messaging ---
  socket.on('message:send', (
    data: {
      conversationId: string;
      text?: string;
      type?: string;
      fileUrl?: string;
      fileName?: string;
      duration?: number;
      replyToId?: string;
      clientMessageId?: string;
    },
    ack?: (result: { ok: boolean; message?: any; error?: string }) => void
  ) => {
    try {
      const done = (result: { ok: boolean; message?: any; error?: string }) => {
        if (typeof ack === 'function') ack(result);
      };

      const message = createAndBroadcastMessage(userId, data);
      done({ ok: true, message });
    } catch (error: any) {
      if (typeof ack === 'function') {
        ack({ ok: false, error: error?.message || 'Ошибка отправки' });
      }
    }
  });

  socket.on('message:read', (data: { conversationId: string }) => {
    stmts.markRead.run(data.conversationId, userId);
    io.to(data.conversationId).emit('message:read', {
      conversationId: data.conversationId,
      readBy: userId,
    });
  });

  socket.on('conversation:join', (conversationId: string) => {
    socket.join(conversationId);
  });

  // --- Typing ---
  socket.on('typing:start', (data: { conversationId: string }) => {
    socket.to(data.conversationId).emit('typing:start', {
      conversationId: data.conversationId,
      userId,
    });
  });

  socket.on('typing:stop', (data: { conversationId: string }) => {
    socket.to(data.conversationId).emit('typing:stop', {
      conversationId: data.conversationId,
      userId,
    });
  });

  // --- WebRTC Signaling ---
  socket.on('call:initiate', (data: { to: string; conversationId: string; callerName: string }) => {
    if (isUserOnline(data.to)) {
      io.to(userRoom(data.to)).emit('call:incoming', {
        from: userId,
        callerName: data.callerName,
        conversationId: data.conversationId,
      });
      return;
    }
    void sendOfflineCallNotifications({
      receiverId: data.to,
      callerId: userId,
      callerName: data.callerName,
      conversationId: data.conversationId,
    }).then((r) => {
      if (!r.ok) {
        socket.emit('call:unavailable', { userId: data.to });
      }
    });
  });

  socket.on('call:accept', (data: { to: string }) => {
    io.to(userRoom(data.to)).emit('call:accepted', { from: userId });
  });

  socket.on('call:reject', (data: { to: string }) => {
    io.to(userRoom(data.to)).emit('call:rejected', { from: userId });
  });

  socket.on('call:end', (data: { to: string }) => {
    io.to(userRoom(data.to)).emit('call:ended', { from: userId });
    pendingIceByPeer.delete(icePendingKey(userId, data.to));
    pendingIceByPeer.delete(icePendingKey(data.to, userId));
    webrtcReadyPeers.delete(webrtcReadyKey(userId, data.to));
    webrtcReadyPeers.delete(webrtcReadyKey(data.to, userId));
  });

  socket.on('webrtc:offer', (data: { to: string; offer: any }) => {
    io.to(userRoom(data.to)).emit('webrtc:offer', { from: userId, offer: data.offer });
  });

  socket.on('webrtc:answer', (data: { to: string; answer: any }) => {
    io.to(userRoom(data.to)).emit('webrtc:answer', { from: userId, answer: data.answer });
  });

  socket.on('webrtc:ice-candidate', (data: { to: string; candidate: any }) => {
    if (!data?.to || !data.candidate) return;
    io.to(userRoom(data.to)).emit('webrtc:ice-candidate', { from: userId, candidate: data.candidate });
    // Buffer only until the peer has registered its listeners (avoids duplicates).
    if (!webrtcReadyPeers.has(webrtcReadyKey(data.to, userId))) {
      pushPendingIce(data.to, userId, data.candidate);
    }
  });

  // Client emits after registering WebRTC listeners so buffered ICE is replayed.
  socket.on('webrtc:ready', (data: { peerId: string }) => {
    if (!data?.peerId) return;
    webrtcReadyPeers.add(webrtcReadyKey(userId, data.peerId));
    flushPendingIce(userId, data.peerId, (payload) => {
      socket.emit('webrtc:ice-candidate', payload);
    });
  });

  socket.on('disconnect', () => {
    const nowOffline = markSocketOffline(userId, socket.id);
    if (!nowOffline) return;

    const timer = setTimeout(() => {
      offlineStatusTimers.delete(userId);
      if (isUserOnline(userId)) return;
      stmts.setOfflineStatus.run(userId);
      emitUserStatus(userId, 'offline');
    }, OFFLINE_STATUS_DEBOUNCE_MS);

    offlineStatusTimers.set(userId, timer);
  });
});

// --- Static Files in Production ---
const CLIENT_DIST = path.resolve(__dirname, '..', '..', 'client', 'dist');
const clientIndexHtml = path.join(CLIENT_DIST, 'index.html');

if (fs.existsSync(clientIndexHtml)) {
  console.log('Serving client from:', CLIENT_DIST);
  app.use(express.static(CLIENT_DIST));
  app.get('*', (_req, res) => {
    res.sendFile(clientIndexHtml);
  });
} else {
  console.log('Client dist not found at:', CLIENT_DIST, '(dev mode)');
}

httpServer.listen(PORT, () => {
  console.log(`MakTime server running on http://localhost:${PORT}`);
  logApnsVoipStartup();
  logApnsAlertStartup();
  logFcmStartup();
  logSmsStartup();
});
