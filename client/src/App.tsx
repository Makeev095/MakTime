import { useState, useCallback } from 'react';
import { useAuth } from './context/AuthContext';
import { useSocket } from './context/SocketContext';
import AuthPage from './components/AuthPage';
import Sidebar from './components/Sidebar';
import ChatWindow from './components/ChatWindow';
import VideoCall from './components/VideoCall';
import IncomingCallModal from './components/IncomingCallModal';
import StoryViewer from './components/StoryViewer';
import StoryUpload from './components/StoryUpload';
import { MessageCircle, Users, Settings } from 'lucide-react';
import type { Conversation, StoryUser } from './types';

type MobileTab = 'chats' | 'contacts' | 'settings';

export default function App() {
  const { user, loading } = useAuth();
  const { incomingCall } = useSocket();
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [callTarget, setCallTarget] = useState<{ userId: string; name: string; conversationId: string; isInitiator: boolean } | null>(null);
  const [callMinimized, setCallMinimized] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [mobileTab, setMobileTab] = useState<MobileTab>('chats');

  // Stories state
  const [storyViewData, setStoryViewData] = useState<{ users: StoryUser[]; startIdx: number } | null>(null);
  const [showStoryUpload, setShowStoryUpload] = useState(false);
  const [storyRefresh, setStoryRefresh] = useState(0);

  const handleConversationUpdate = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const handleSelectConversation = useCallback((conv: Conversation) => {
    setActiveConversation(conv);
    if (window.innerWidth < 768) {
      setShowSidebar(false);
      setMobileTab('chats');
    }
  }, []);

  const handleStartCall = useCallback((userId: string, name: string, conversationId: string) => {
    setCallTarget({ userId, name, conversationId, isInitiator: true });
    setCallMinimized(false);
  }, []);

  const handleEndCall = useCallback(() => {
    setCallTarget(null);
    setCallMinimized(false);
  }, []);

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>MakTime</p>
      </div>
    );
  }

  if (!user) return <AuthPage />;

  const handleAcceptCall = () => {
    if (incomingCall) {
      setCallTarget({
        userId: incomingCall.from,
        name: incomingCall.callerName,
        conversationId: incomingCall.conversationId,
        isInitiator: false,
      });
    }
  };

  return (
    <div className="app">
      <div className={`sidebar-container ${showSidebar ? 'visible' : ''}`}>
        <Sidebar
          activeConversationId={activeConversation?.id || null}
          onSelectConversation={handleSelectConversation}
          onViewStories={(users, startIdx) => setStoryViewData({ users, startIdx })}
          onAddStory={() => setShowStoryUpload(true)}
          refreshKey={refreshKey}
          mobileTab={mobileTab}
        />
      </div>

      <div className={`main-container ${!showSidebar ? 'visible' : ''}`}>
        {activeConversation ? (
          <ChatWindow
            conversation={activeConversation}
            onBack={() => setShowSidebar(true)}
            onStartCall={handleStartCall}
            onConversationUpdate={handleConversationUpdate}
          />
        ) : (
          <div className="empty-state">
            <div className="empty-state-content">
              <div className="empty-state-icon">💬</div>
              <h2>MakTime</h2>
              <p>Выберите чат или начните новый разговор</p>
            </div>
          </div>
        )}
      </div>

      {showSidebar && (
        <div className="mobile-tab-bar">
          <button
            className={`mobile-tab ${mobileTab === 'chats' ? 'active' : ''}`}
            onClick={() => setMobileTab('chats')}
          >
            <MessageCircle size={22} />
            <span>Чаты</span>
          </button>
          <button
            className={`mobile-tab ${mobileTab === 'contacts' ? 'active' : ''}`}
            onClick={() => setMobileTab('contacts')}
          >
            <Users size={22} />
            <span>Контакты</span>
          </button>
          <button
            className={`mobile-tab ${mobileTab === 'settings' ? 'active' : ''}`}
            onClick={() => setMobileTab('settings')}
          >
            <Settings size={22} />
            <span>Настройки</span>
          </button>
        </div>
      )}

      {callTarget && (
        <VideoCall
          targetUserId={callTarget.userId}
          targetName={callTarget.name}
          conversationId={callTarget.conversationId}
          isInitiator={callTarget.isInitiator}
          onEnd={handleEndCall}
          minimized={callMinimized}
          onToggleMinimize={() => setCallMinimized((m) => !m)}
        />
      )}

      {incomingCall && !callTarget && (
        <IncomingCallModal onAccept={handleAcceptCall} />
      )}

      {storyViewData && (
        <StoryViewer
          storyUsers={storyViewData.users}
          startUserIdx={storyViewData.startIdx}
          onClose={() => setStoryViewData(null)}
        />
      )}

      {showStoryUpload && (
        <StoryUpload
          onClose={() => setShowStoryUpload(false)}
          onPublished={() => setStoryRefresh((k) => k + 1)}
        />
      )}
    </div>
  );
}
