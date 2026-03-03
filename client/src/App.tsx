import { useState } from 'react';
import { useAuth } from './context/AuthContext';
import { useSocket } from './context/SocketContext';
import AuthPage from './components/AuthPage';
import Sidebar from './components/Sidebar';
import ChatWindow from './components/ChatWindow';
import VideoCall from './components/VideoCall';
import IncomingCallModal from './components/IncomingCallModal';
import StoryViewer from './components/StoryViewer';
import StoryUpload from './components/StoryUpload';
import type { Conversation, StoryUser } from './types';

export default function App() {
  const { user, loading } = useAuth();
  const { incomingCall } = useSocket();
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [callTarget, setCallTarget] = useState<{ userId: string; name: string; conversationId: string } | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Stories state
  const [storyViewData, setStoryViewData] = useState<{ users: StoryUser[]; startIdx: number } | null>(null);
  const [showStoryUpload, setShowStoryUpload] = useState(false);
  const [storyRefresh, setStoryRefresh] = useState(0);

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>MakTime</p>
      </div>
    );
  }

  if (!user) return <AuthPage />;

  const handleSelectConversation = (conv: Conversation) => {
    setActiveConversation(conv);
    if (window.innerWidth < 768) setShowSidebar(false);
  };

  const handleStartCall = (userId: string, name: string, conversationId: string) => {
    setCallTarget({ userId, name, conversationId });
  };

  const handleAcceptCall = () => {
    if (incomingCall) {
      setCallTarget({
        userId: incomingCall.from,
        name: incomingCall.callerName,
        conversationId: incomingCall.conversationId,
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
        />
      </div>

      <div className={`main-container ${!showSidebar ? 'visible' : ''}`}>
        {activeConversation ? (
          <ChatWindow
            conversation={activeConversation}
            onBack={() => setShowSidebar(true)}
            onStartCall={handleStartCall}
            onConversationUpdate={() => setRefreshKey((k) => k + 1)}
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

      {callTarget && (
        <VideoCall
          targetUserId={callTarget.userId}
          targetName={callTarget.name}
          conversationId={callTarget.conversationId}
          isInitiator={!incomingCall || incomingCall.from !== callTarget.userId}
          onEnd={() => setCallTarget(null)}
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
