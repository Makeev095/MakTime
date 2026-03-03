import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { X, ChevronLeft, ChevronRight, Eye, Trash2, Send } from 'lucide-react';
import type { StoryUser } from '../types';

interface Props {
  storyUsers: StoryUser[];
  startUserIdx: number;
  onClose: () => void;
}

const STORY_DURATION = 6000;
const REACTION_EMOJIS = ['❤️', '🔥', '😂', '😮', '😢', '👏'];

export default function StoryViewer({ storyUsers, startUserIdx, onClose }: Props) {
  const { user, token } = useAuth();
  const { socket } = useSocket();
  const [userIdx, setUserIdx] = useState(startUserIdx);
  const [storyIdx, setStoryIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reply, setReply] = useState('');
  const [showViewers, setShowViewers] = useState(false);
  const [viewers, setViewers] = useState<any[]>([]);
  const [reactedEmoji, setReactedEmoji] = useState<string | null>(null);
  const timerRef = useRef<number>();
  const videoRef = useRef<HTMLVideoElement>(null);

  const currentUser = storyUsers[userIdx];
  const currentStory = currentUser?.stories[storyIdx];
  const isOwn = currentUser?.isOwn;

  const markViewed = useCallback(async (storyId: string) => {
    await fetch(`/api/stories/${storyId}/view`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  }, [token]);

  const goNext = useCallback(() => {
    if (!currentUser) return;
    if (storyIdx < currentUser.stories.length - 1) {
      setStoryIdx((i) => i + 1);
      setProgress(0);
    } else if (userIdx < storyUsers.length - 1) {
      setUserIdx((i) => i + 1);
      setStoryIdx(0);
      setProgress(0);
    } else {
      onClose();
    }
  }, [currentUser, storyIdx, userIdx, storyUsers.length, onClose]);

  const goPrev = useCallback(() => {
    if (storyIdx > 0) {
      setStoryIdx((i) => i - 1);
      setProgress(0);
    } else if (userIdx > 0) {
      setUserIdx((i) => i - 1);
      const prevUser = storyUsers[userIdx - 1];
      setStoryIdx(prevUser ? prevUser.stories.length - 1 : 0);
      setProgress(0);
    }
  }, [storyIdx, userIdx, storyUsers]);

  // Progress timer
  useEffect(() => {
    if (!currentStory || paused) return;

    markViewed(currentStory.id);

    const isVideo = currentStory.type === 'video';
    if (isVideo && videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {});
    }

    const duration = isVideo ? (videoRef.current?.duration || 10) * 1000 : STORY_DURATION;
    const interval = 50;
    let elapsed = 0;

    timerRef.current = window.setInterval(() => {
      elapsed += interval;
      setProgress(Math.min((elapsed / duration) * 100, 100));
      if (elapsed >= duration) {
        goNext();
      }
    }, interval);

    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [currentStory?.id, paused, goNext, markViewed]);

  // Reset on story change
  useEffect(() => {
    setProgress(0);
    setShowViewers(false);
    setReactedEmoji(null);
  }, [currentStory?.id]);

  const handleTap = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < rect.width * 0.3) goPrev();
    else if (x > rect.width * 0.7) goNext();
    else setPaused((p) => !p);
  };

  const fetchViewers = async () => {
    if (!currentStory) return;
    const res = await fetch(`/api/stories/${currentStory.id}/viewers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setViewers(await res.json());
    setShowViewers(true);
    setPaused(true);
  };

  const sendReaction = async (emoji: string) => {
    if (!currentStory) return;
    setReactedEmoji(emoji);
    await fetch(`/api/stories/${currentStory.id}/react`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ emoji }),
    });
    setTimeout(() => setReactedEmoji(null), 1500);
  };

  const deleteStory = async () => {
    if (!currentStory) return;
    await fetch(`/api/stories/${currentStory.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    goNext();
  };

  const sendReply = async () => {
    if (!reply.trim() || !currentUser || !socket) return;
    const convRes = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ participantId: currentUser.userId }),
    });
    if (!convRes.ok) return;
    const { id: convId } = await convRes.json();

    socket.emit('conversation:join', convId);
    socket.emit('message:send', {
      conversationId: convId,
      text: `📷 Ответ на историю: ${reply.trim()}`,
      type: 'text',
    });
    setReply('');
    setPaused(false);
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const h = Math.floor(diff / 3600000);
    const m = Math.floor(diff / 60000);
    if (h > 0) return `${h}ч назад`;
    if (m > 0) return `${m}м назад`;
    return 'только что';
  };

  if (!currentStory || !currentUser) return null;

  return (
    <div className="story-viewer-overlay">
      <div className="story-viewer" onClick={handleTap}>
        {/* Progress bars */}
        <div className="story-progress-bar">
          {currentUser.stories.map((_, i) => (
            <div key={i} className="story-progress-segment">
              <div
                className="story-progress-fill"
                style={{
                  width: i < storyIdx ? '100%' : i === storyIdx ? `${progress}%` : '0%',
                }}
              />
            </div>
          ))}
        </div>

        {/* Header */}
        <div className="story-header">
          <div className="story-header-user">
            <div className="story-header-avatar" style={{ background: currentUser.avatarColor }}>
              {currentUser.displayName[0].toUpperCase()}
            </div>
            <div>
              <div className="story-header-name">{currentUser.displayName}</div>
              <div className="story-header-time">{timeAgo(currentStory.createdAt)}</div>
            </div>
          </div>
          <div className="story-header-actions">
            {isOwn && (
              <button onClick={(e) => { e.stopPropagation(); deleteStory(); }} className="story-action-btn">
                <Trash2 size={20} />
              </button>
            )}
            <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="story-action-btn">
              <X size={22} />
            </button>
          </div>
        </div>

        {/* Content */}
        {currentStory.type === 'image' ? (
          <img src={currentStory.fileUrl} className="story-media" alt="" />
        ) : (
          <video ref={videoRef} src={currentStory.fileUrl} className="story-media" playsInline />
        )}

        {currentStory.textOverlay && (
          <div className="story-text-overlay" style={{ background: currentStory.bgColor || 'rgba(0,0,0,0.5)' }}>
            {currentStory.textOverlay}
          </div>
        )}

        {/* Reaction animation */}
        {reactedEmoji && (
          <div className="story-reaction-anim">{reactedEmoji}</div>
        )}

        {/* Navigation arrows on desktop */}
        {userIdx > 0 && (
          <button className="story-nav story-nav-left" onClick={(e) => { e.stopPropagation(); goPrev(); }}>
            <ChevronLeft size={32} />
          </button>
        )}
        {(storyIdx < currentUser.stories.length - 1 || userIdx < storyUsers.length - 1) && (
          <button className="story-nav story-nav-right" onClick={(e) => { e.stopPropagation(); goNext(); }}>
            <ChevronRight size={32} />
          </button>
        )}

        {/* Bottom area */}
        <div className="story-bottom" onClick={(e) => e.stopPropagation()}>
          {isOwn ? (
            <button className="story-viewers-btn" onClick={fetchViewers}>
              <Eye size={18} />
              <span>{currentStory.viewCount} просмотров</span>
            </button>
          ) : (
            <>
              <div className="story-reactions-row">
                {REACTION_EMOJIS.map((emoji) => (
                  <button key={emoji} className="story-emoji-btn" onClick={() => sendReaction(emoji)}>
                    {emoji}
                  </button>
                ))}
              </div>
              <div className="story-reply-bar">
                <input
                  type="text"
                  placeholder="Ответить..."
                  value={reply}
                  onChange={(e) => { setReply(e.target.value); setPaused(true); }}
                  onBlur={() => !reply && setPaused(false)}
                />
                {reply.trim() && (
                  <button className="story-reply-send" onClick={sendReply}>
                    <Send size={18} />
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Viewers panel */}
      {showViewers && (
        <div className="story-viewers-panel" onClick={(e) => e.stopPropagation()}>
          <div className="story-viewers-header">
            <span>Просмотры ({viewers.length})</span>
            <button onClick={() => { setShowViewers(false); setPaused(false); }} className="story-action-btn">
              <X size={18} />
            </button>
          </div>
          <div className="story-viewers-list">
            {viewers.length === 0 && <p className="story-no-viewers">Пока нет просмотров</p>}
            {viewers.map((v) => (
              <div key={v.userId} className="story-viewer-item">
                <div className="avatar small" style={{ background: v.avatarColor }}>
                  {v.displayName[0].toUpperCase()}
                </div>
                <span>{v.displayName}</span>
                <span className="story-viewer-time">{timeAgo(v.viewedAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
