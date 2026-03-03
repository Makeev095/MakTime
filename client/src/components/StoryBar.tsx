import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { Plus } from 'lucide-react';
import type { StoryUser } from '../types';

interface Props {
  onViewStories: (users: StoryUser[], startIdx: number) => void;
  onAddStory: () => void;
}

export default function StoryBar({ onViewStories, onAddStory }: Props) {
  const { token, user } = useAuth();
  const { socket } = useSocket();
  const [storyUsers, setStoryUsers] = useState<StoryUser[]>([]);

  const fetchStories = useCallback(async () => {
    const res = await fetch('/api/stories', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setStoryUsers(await res.json());
  }, [token]);

  useEffect(() => {
    fetchStories();
  }, [fetchStories]);

  useEffect(() => {
    if (!socket) return;
    const handler = () => fetchStories();
    socket.on('story:new', handler);
    return () => { socket.off('story:new', handler); };
  }, [socket, fetchStories]);

  const myStories = storyUsers.find((su) => su.isOwn);
  const otherStories = storyUsers.filter((su) => !su.isOwn);

  const handleView = (idx: number) => {
    onViewStories(storyUsers, idx);
  };

  if (storyUsers.length === 0 && !user) return null;

  return (
    <div className="story-bar">
      {/* My story / Add button */}
      <div className="story-item" onClick={myStories ? () => handleView(0) : onAddStory}>
        <div className={`story-ring ${myStories?.hasUnviewed ? '' : 'viewed'} ${!myStories ? 'no-story' : ''}`}>
          <div className="story-avatar" style={{ background: user?.avatarColor }}>
            {user?.displayName?.[0]?.toUpperCase()}
            {!myStories && (
              <span className="story-add-badge"><Plus size={12} /></span>
            )}
          </div>
        </div>
        <span className="story-name">{myStories ? 'Моя история' : 'Добавить'}</span>
      </div>

      {otherStories.map((su, i) => {
        const globalIdx = myStories ? i + 1 : i;
        return (
          <div key={su.userId} className="story-item" onClick={() => handleView(globalIdx)}>
            <div className={`story-ring ${su.hasUnviewed ? '' : 'viewed'}`}>
              <div className="story-avatar" style={{ background: su.avatarColor }}>
                {su.displayName[0].toUpperCase()}
              </div>
            </div>
            <span className="story-name">{su.displayName.split(' ')[0]}</span>
          </div>
        );
      })}
    </div>
  );
}
