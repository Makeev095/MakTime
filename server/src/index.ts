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

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 10 * 1024 * 1024,
});

const JWT_SECRET = process.env.JWT_SECRET || 'maktime-secret-key-change-in-production';
const PORT = process.env.PORT || 3001;
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

['images', 'voice', 'files', 'video'].forEach((dir) => {
  fs.mkdirSync(path.join(UPLOADS_DIR, dir), { recursive: true });
});

// --- Security ---
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, try again later' },
});
app.use('/api/', apiLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many auth attempts, try again later' },
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
  limits: { fileSize: 50 * 1024 * 1024 },
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

// --- Prepared Statements ---
const stmts = {
  createUser: db.prepare(
    'INSERT INTO users (id, username, display_name, password_hash, avatar_color) VALUES (?, ?, ?, ?, ?)'
  ),
  findUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  findUserById: db.prepare(
    'SELECT id, username, display_name, avatar_color, bio, status, last_seen FROM users WHERE id = ?'
  ),
  searchUsers: db.prepare(
    "SELECT id, username, display_name, avatar_color, status FROM users WHERE (username LIKE ? OR display_name LIKE ?) AND id != ? LIMIT 20"
  ),
  updateStatus: db.prepare("UPDATE users SET status = ?, last_seen = datetime('now') WHERE id = ?"),
  updateProfile: db.prepare('UPDATE users SET display_name = ?, bio = ? WHERE id = ?'),

  addContact: db.prepare('INSERT OR IGNORE INTO contacts (user_id, contact_id) VALUES (?, ?)'),
  getContacts: db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar_color, u.status, u.last_seen
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
      AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.deleted = 0)
    ORDER BY last_message_time DESC NULLS LAST
  `),
  getConversationParticipants: db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar_color, u.status, u.last_seen
    FROM conversation_participants cp JOIN users u ON cp.user_id = u.id
    WHERE cp.conversation_id = ?
  `),

  createMessage: db.prepare(`
    INSERT INTO messages (id, conversation_id, sender_id, type, text, file_url, file_name, duration, reply_to_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getMessages: db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? AND deleted = 0 ORDER BY created_at ASC LIMIT 200'
  ),
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
      u.username, u.display_name, u.avatar_color,
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
    SELECT sv.viewed_at, u.id, u.username, u.display_name, u.avatar_color
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
};

function sanitize(str: string): string {
  return str.replace(/[<>&"']/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#x27;' })[c] || c
  );
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
    createdAt: m.created_at,
    read: !!m.read,
  };
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
    if (username.length < 3) return res.status(400).json({ error: 'Минимум 3 символа для имени' });
    if (password.length < 6) return res.status(400).json({ error: 'Минимум 6 символов для пароля' });

    const cyrilToLatin: Record<string, string> = {
      'а':'a','в':'v','с':'c','е':'e','к':'k','м':'m','н':'n',
      'о':'o','р':'p','т':'t','х':'x','у':'y','А':'A','В':'V',
      'С':'C','Е':'E','К':'K','М':'M','Н':'N','О':'O','Р':'P',
      'Т':'T','Х':'X','У':'Y',
    };
    const normalized = username.split('').map((ch: string) => cyrilToLatin[ch] || ch).join('');
    const clean = normalized.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (clean.length < 3) {
      return res.status(400).json({ error: 'Минимум 3 символа (латиница, цифры, _)' });
    }

    const existing = stmts.findUserByUsername.get(clean);
    if (existing) return res.status(409).json({ error: 'Имя занято' });

    const id = uuidv4();
    const hash = bcrypt.hashSync(password, 12);
    const colors = ['#6C63FF', '#FF6584', '#43AA8B', '#F9844A', '#577590', '#F94144', '#90BE6D', '#4ECDC4'];
    const color = colors[Math.floor(Math.random() * colors.length)];

    stmts.createUser.run(id, clean, sanitize(displayName), hash, color);

    const token = jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
      token,
      user: { id, username: clean, displayName: sanitize(displayName), avatarColor: color, bio: '' },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Введите имя и пароль' });
    const cyrilToLatin: Record<string, string> = {
      'а':'a','в':'v','с':'c','е':'e','к':'k','м':'m','н':'n',
      'о':'o','р':'p','т':'t','х':'x','у':'y','А':'A','В':'V',
      'С':'C','Е':'E','К':'K','М':'M','Н':'N','О':'O','Р':'P',
      'Т':'T','Х':'X','У':'Y',
    };
    const normalized = username.split('').map((ch: string) => cyrilToLatin[ch] || ch).join('');
    const cleanLogin = normalized.toLowerCase().replace(/[^a-z0-9_]/g, '');
    const user = stmts.findUserByUsername.get(cleanLogin) as any;
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Неверные данные' });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        avatarColor: user.avatar_color,
        bio: user.bio || '',
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = stmts.findUserById.get((req as any).userId) as any;
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    avatarColor: user.avatar_color,
    bio: user.bio || '',
  });
});

app.put('/api/auth/profile', authMiddleware, (req, res) => {
  const { displayName, bio } = req.body;
  const userId = (req as any).userId;
  stmts.updateProfile.run(sanitize(displayName || ''), sanitize(bio || ''), userId);
  const user = stmts.findUserById.get(userId) as any;
  res.json({
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    avatarColor: user.avatar_color,
    bio: user.bio || '',
  });
});

// --- Search & Contacts ---
app.get('/api/users/search', authMiddleware, (req, res) => {
  const query = req.query.q as string;
  if (!query || query.length < 2) return res.json([]);
  const q = `%${query.toLowerCase()}%`;
  const users = stmts.searchUsers.all(q, q, (req as any).userId) as any[];
  res.json(
    users.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.display_name,
      avatarColor: u.avatar_color,
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
      status: c.status,
      lastSeen: c.last_seen,
    }))
  );
});

// --- Conversations ---
app.get('/api/conversations', authMiddleware, (req, res) => {
  const userId = (req as any).userId;
  const conversations = stmts.getUserConversations.all(userId, userId) as any[];
  const result = conversations.map((conv) => {
    const participants = stmts.getConversationParticipants.all(conv.id) as any[];
    const other = participants.find((p: any) => p.id !== userId);
    return {
      id: conv.id,
      lastMessage: conv.last_message,
      lastMessageType: conv.last_message_type || 'text',
      lastMessageTime: conv.last_message_time,
      unreadCount: conv.unread_count,
      participant: other
        ? {
            id: other.id,
            username: other.username,
            displayName: other.display_name,
            avatarColor: other.avatar_color,
            status: other.status,
            lastSeen: other.last_seen,
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
  if (existing) return res.json({ id: existing.conversation_id, existing: true });

  const id = uuidv4();
  stmts.createConversation.run(id);
  stmts.addParticipant.run(id, userId);
  stmts.addParticipant.run(id, participantId);

  res.json({ id, existing: false });
});

app.get('/api/conversations/:id/messages', authMiddleware, (req, res) => {
  const userId = (req as any).userId;
  const messages = stmts.getMessages.all(req.params.id) as any[];
  stmts.markRead.run(req.params.id, userId);
  res.json(messages.map(formatMessage));
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
  const ownerSocket = onlineUsers.get(story.user_id);
  if (ownerSocket) {
    io.to(ownerSocket).emit('story:reaction', {
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

// --- Socket.IO ---
const onlineUsers = new Map<string, string>();

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
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
  onlineUsers.set(userId, socket.id);
  stmts.updateStatus.run('online', userId);
  io.emit('user:status', { userId, status: 'online' });

  const conversations = stmts.getUserConversations.all(userId, userId) as any[];
  conversations.forEach((c) => socket.join(c.id));

  // --- Messaging ---
  socket.on('message:send', (data: {
    conversationId: string;
    text?: string;
    type?: string;
    fileUrl?: string;
    fileName?: string;
    duration?: number;
    replyToId?: string;
  }) => {
    // Verify sender is a participant
    const participants = stmts.getConversationParticipants.all(data.conversationId) as any[];
    if (!participants.some((p) => p.id === userId)) return;
    if (data.fileUrl && !data.fileUrl.startsWith('/uploads/')) return;

    const msgId = uuidv4();
    const type = data.type || 'text';
    const text = data.text ? sanitize(data.text) : '';

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

    // Check if this is the first message in the conversation — notify recipient
    const msgCount = (db.prepare(
      'SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ? AND deleted = 0'
    ).get(data.conversationId) as any).cnt;

    participants.forEach((p) => {
      if (p.id !== userId) {
        const sid = onlineUsers.get(p.id);
        if (sid) {
          const targetSocket = io.sockets.sockets.get(sid);
          if (targetSocket) {
            if (!targetSocket.rooms.has(data.conversationId)) {
              targetSocket.join(data.conversationId);
              targetSocket.emit('message:new', message);
            }
            if (msgCount === 1) {
              targetSocket.emit('conversation:created', { id: data.conversationId });
            }
          }
        }
      }
    });
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
    const targetSocketId = onlineUsers.get(data.to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('call:incoming', {
        from: userId,
        callerName: data.callerName,
        conversationId: data.conversationId,
      });
    } else {
      socket.emit('call:unavailable', { userId: data.to });
    }
  });

  socket.on('call:accept', (data: { to: string }) => {
    const sid = onlineUsers.get(data.to);
    if (sid) io.to(sid).emit('call:accepted', { from: userId });
  });

  socket.on('call:reject', (data: { to: string }) => {
    const sid = onlineUsers.get(data.to);
    if (sid) io.to(sid).emit('call:rejected', { from: userId });
  });

  socket.on('call:end', (data: { to: string }) => {
    const sid = onlineUsers.get(data.to);
    if (sid) io.to(sid).emit('call:ended', { from: userId });
  });

  socket.on('webrtc:offer', (data: { to: string; offer: any }) => {
    const sid = onlineUsers.get(data.to);
    if (sid) io.to(sid).emit('webrtc:offer', { from: userId, offer: data.offer });
  });

  socket.on('webrtc:answer', (data: { to: string; answer: any }) => {
    const sid = onlineUsers.get(data.to);
    if (sid) io.to(sid).emit('webrtc:answer', { from: userId, answer: data.answer });
  });

  socket.on('webrtc:ice-candidate', (data: { to: string; candidate: any }) => {
    const sid = onlineUsers.get(data.to);
    if (sid) io.to(sid).emit('webrtc:ice-candidate', { from: userId, candidate: data.candidate });
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(userId);
    stmts.updateStatus.run('offline', userId);
    io.emit('user:status', { userId, status: 'offline' });
  });
});

// --- Static Files in Production ---
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../../client/dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
  });
}

httpServer.listen(PORT, () => {
  console.log(`MakTime server running on http://localhost:${PORT}`);
});
