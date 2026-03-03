import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { playNotificationSound } from '../context/SocketContext';
import StoryBar from './StoryBar';
import { Search, LogOut, Plus, MessageCircle, Settings, X, Users, Mail, MessageSquare } from 'lucide-react';
import type { Conversation, User, StoryUser } from '../types';

type SidebarTab = 'all' | 'unread' | 'contacts';

interface Props {
  activeConversationId: string | null;
  onSelectConversation: (conv: Conversation) => void;
  onViewStories: (users: StoryUser[], startIdx: number) => void;
  onAddStory: () => void;
  refreshKey: number;
}

export default function Sidebar({ activeConversationId, onSelectConversation, onViewStories, onAddStory, refreshKey }: Props) {
  const { user, token, logout } = useAuth();
  const { socket, onConversationCreated } = useSocket();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [contacts, setContacts] = useState<User[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [bio, setBio] = useState('');
  const [activeTab, setActiveTab] = useState<SidebarTab>('all');

  const fetchConversations = useCallback(async () => {
    const res = await fetch('/api/conversations', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setConversations(await res.json());
  }, [token]);

  const fetchContacts = useCallback(async () => {
    const res = await fetch('/api/contacts', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setContacts(await res.json());
  }, [token]);

  useEffect(() => {
    fetchConversations();
    fetchContacts();
  }, [fetchConversations, fetchContacts, refreshKey]);

  useEffect(() => {
    if (!socket) return;
    const handler = () => {
      fetchConversations();
      playNotificationSound();
    };
    socket.on('message:new', handler);
    return () => { socket.off('message:new', handler); };
  }, [socket, fetchConversations]);

  useEffect(() => {
    const unsub = onConversationCreated(() => {
      fetchConversations();
    });
    return unsub;
  }, [onConversationCreated, fetchConversations]);

  useEffect(() => {
    if (!socket) return;
    const handleStatus = (data: { userId: string; status: string }) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.participant?.id === data.userId
            ? { ...c, participant: { ...c.participant!, status: data.status } }
            : c
        )
      );
      setContacts((prev) =>
        prev.map((ct) => ct.id === data.userId ? { ...ct, status: data.status } : ct)
      );
    };
    socket.on('user:status', handleStatus);
    return () => { socket.off('user:status', handleStatus); };
  }, [socket]);

  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(searchQuery)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setSearchResults(await res.json());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, token]);

  const filteredConversations = useMemo(() => {
    if (activeTab === 'unread') return conversations.filter((c) => c.unreadCount > 0);
    return conversations;
  }, [conversations, activeTab]);

  const unreadTotal = useMemo(() =>
    conversations.reduce((sum, c) => sum + c.unreadCount, 0),
  [conversations]);

  const startConversation = async (contactId: string) => {
    await fetch(`/api/contacts/${contactId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    const res = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ participantId: contactId }),
    });

    if (res.ok) {
      const { id } = await res.json();
      socket?.emit('conversation:join', id);
      setShowSearch(false);
      setSearchQuery('');
      setActiveTab('all');

      const contact = searchResults.find((u) => u.id === contactId) ||
        contacts.find((u) => u.id === contactId);
      onSelectConversation({
        id,
        lastMessage: null,
        lastMessageTime: null,
        unreadCount: 0,
        participant: contact || null,
      });

      fetchContacts();
    }
  };

  const saveProfile = async () => {
    await fetch('/api/auth/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ displayName, bio }),
    });
    setShowProfile(false);
  };

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('ru', { day: 'numeric', month: 'short' });
  };

  const lastMsgPreview = (conv: Conversation) => {
    if (!conv.lastMessage && !conv.lastMessageType) return 'Нет сообщений';
    switch (conv.lastMessageType) {
      case 'voice': return '🎤 Голосовое сообщение';
      case 'image': return '📷 Фото';
      case 'video': return '🎥 Видео';
      case 'file': return '📎 Файл';
      default: return conv.lastMessage || 'Нет сообщений';
    }
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-header-top">
          <div className="sidebar-logo">
            <MessageCircle size={24} />
            <span>MakTime</span>
          </div>
          <div className="sidebar-actions">
            <button className="icon-btn" onClick={() => { setShowSearch(!showSearch); setShowProfile(false); }} title="Новый чат">
              <Plus size={20} />
            </button>
            <button className="icon-btn" onClick={() => { setShowProfile(!showProfile); setShowSearch(false); }} title="Профиль">
              <Settings size={20} />
            </button>
            <button className="icon-btn" onClick={logout} title="Выйти">
              <LogOut size={20} />
            </button>
          </div>
        </div>

        {showSearch && (
          <div className="search-bar">
            <Search size={18} className="search-icon" />
            <input
              type="text"
              placeholder="Поиск по имени или @username..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
            {searchQuery && (
              <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => setSearchQuery('')}>
                <X size={14} />
              </button>
            )}
          </div>
        )}
      </div>

      {showProfile && (
        <div className="profile-panel">
          <div className="profile-avatar" style={{ background: user?.avatarColor }}>
            {user?.displayName?.[0]?.toUpperCase()}
          </div>
          <div className="profile-username">@{user?.username}</div>
          <div className="input-group" style={{ margin: '8px 0' }}>
            <input
              type="text"
              placeholder="Отображаемое имя"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="input-group" style={{ margin: '8px 0' }}>
            <input
              type="text"
              placeholder="О себе..."
              value={bio}
              onChange={(e) => setBio(e.target.value)}
            />
          </div>
          <button className="auth-submit" style={{ width: '100%', padding: '10px' }} onClick={saveProfile}>
            Сохранить
          </button>
        </div>
      )}

      <StoryBar onViewStories={onViewStories} onAddStory={onAddStory} />

      <div className="sidebar-tabs">
        <button
          className={`sidebar-tab ${activeTab === 'all' ? 'active' : ''}`}
          onClick={() => setActiveTab('all')}
        >
          <MessageSquare size={16} />
          <span>Все</span>
        </button>
        <button
          className={`sidebar-tab ${activeTab === 'unread' ? 'active' : ''}`}
          onClick={() => setActiveTab('unread')}
        >
          <Mail size={16} />
          <span>Непрочитанные</span>
          {unreadTotal > 0 && <span className="tab-badge">{unreadTotal}</span>}
        </button>
        <button
          className={`sidebar-tab ${activeTab === 'contacts' ? 'active' : ''}`}
          onClick={() => setActiveTab('contacts')}
        >
          <Users size={16} />
          <span>Контакты</span>
        </button>
      </div>

      <div className="sidebar-content">
        {showSearch && searchResults.length > 0 && (
          <div className="search-results">
            <div className="section-label">Пользователи</div>
            {searchResults.map((u) => (
              <button key={u.id} className="contact-item" onClick={() => startConversation(u.id)}>
                <div className="avatar" style={{ background: u.avatarColor }}>
                  {u.displayName[0].toUpperCase()}
                </div>
                <div className="contact-info">
                  <span className="contact-name">{u.displayName}</span>
                  <span className="contact-username">@{u.username}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {activeTab === 'contacts' ? (
          <div className="contacts-list">
            {contacts.length === 0 ? (
              <div className="no-conversations">
                <p>Нет контактов</p>
                <p className="hint">Найдите собеседника через поиск</p>
              </div>
            ) : contacts.map((ct) => (
              <button key={ct.id} className="contact-item" onClick={() => startConversation(ct.id)}>
                <div className="avatar" style={{ background: ct.avatarColor }}>
                  {ct.displayName[0].toUpperCase()}
                  {ct.status === 'online' && <span className="online-dot" />}
                </div>
                <div className="contact-info">
                  <span className="contact-name">{ct.displayName}</span>
                  <span className="contact-username">@{ct.username}</span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="conversations-list">
            {filteredConversations.length === 0 && !showSearch && (
              <div className="no-conversations">
                <p>{activeTab === 'unread' ? 'Нет непрочитанных' : 'Нет чатов'}</p>
                <p className="hint">
                  {activeTab === 'unread' ? 'Все сообщения прочитаны' : 'Нажмите + чтобы найти собеседника'}
                </p>
              </div>
            )}

            {filteredConversations.map((conv) => (
              <button
                key={conv.id}
                className={`conversation-item ${activeConversationId === conv.id ? 'active' : ''}`}
                onClick={() => onSelectConversation(conv)}
              >
                <div className="avatar" style={{ background: conv.participant?.avatarColor || '#999' }}>
                  {conv.participant?.displayName?.[0]?.toUpperCase() || '?'}
                  {conv.participant?.status === 'online' && <span className="online-dot" />}
                </div>
                <div className="conversation-info">
                  <div className="conversation-top">
                    <span className="conversation-name">
                      {conv.participant?.displayName || 'Пользователь'}
                    </span>
                    <span className="conversation-time">
                      {formatTime(conv.lastMessageTime)}
                    </span>
                  </div>
                  <div className="conversation-bottom">
                    <span className="conversation-preview">{lastMsgPreview(conv)}</span>
                    {conv.unreadCount > 0 && (
                      <span className="unread-badge">{conv.unreadCount}</span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <div className="avatar small" style={{ background: user?.avatarColor }}>
          {user?.displayName?.[0]?.toUpperCase()}
        </div>
        <span className="current-user-name">{user?.displayName}</span>
      </div>
    </div>
  );
}
