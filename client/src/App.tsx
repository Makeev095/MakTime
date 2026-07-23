import { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { useAuth } from './context/AuthContext';
import { useSocket } from './context/SocketContext';
import AuthPage from './components/AuthPage';
import Sidebar from './components/Sidebar';
import { MessageCircle, Users, Settings } from 'lucide-react';
import type { Conversation, StoryUser } from './types';
import { useNativePushRegistration } from './hooks/useNativePushRegistration';

const ChatWindow = lazy(() => import('./components/ChatWindow'));
const VideoCall = lazy(() => import('./components/VideoCall'));
const IncomingCallModal = lazy(() => import('./components/IncomingCallModal'));
const StoryViewer = lazy(() => import('./components/StoryViewer'));
const StoryUpload = lazy(() => import('./components/StoryUpload'));

type MobileTab = 'chats' | 'contacts' | 'settings';

export default function App() {
  const { user, token, loading } = useAuth();
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

  useNativePushRegistration(token, handleConversationUpdate);

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

  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    let rafId = 0;
    let stableHeight = window.innerHeight;

    const applyViewport = () => {
      const visualHeight = vv?.height ?? window.innerHeight;
      const visualOffsetTop = vv?.offsetTop ?? 0;
      const rawKeyboardInset = Math.max(0, stableHeight - (visualHeight + visualOffsetTop));
      const keyboardOpen = rawKeyboardInset > 90;

      if (!keyboardOpen) {
        const nextLayoutHeight = window.innerHeight;
        if (Math.abs(nextLayoutHeight - stableHeight) > 120) {
          // orientation / full viewport change
          stableHeight = nextLayoutHeight;
        } else {
          stableHeight = Math.max(stableHeight, nextLayoutHeight);
        }
      }

      root.style.setProperty('--app-height', `${stableHeight}px`);
      root.style.setProperty('--keyboard-inset', `${keyboardOpen ? Math.round(rawKeyboardInset) : 0}px`);
      root.classList.toggle('keyboard-open', keyboardOpen);
    };

    const updateViewport = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(applyViewport);
    };

    updateViewport();
    window.addEventListener('resize', updateViewport);
    window.addEventListener('orientationchange', updateViewport);
    vv?.addEventListener('resize', updateViewport);
    vv?.addEventListener('scroll', updateViewport);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', updateViewport);
      window.removeEventListener('orientationchange', updateViewport);
      vv?.removeEventListener('resize', updateViewport);
      vv?.removeEventListener('scroll', updateViewport);
      root.style.removeProperty('--app-height');
      root.style.removeProperty('--keyboard-inset');
      root.classList.remove('keyboard-open');
    };
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
          <Suspense fallback={<div className="loading-screen"><div className="loading-spinner" /></div>}>
          <ChatWindow
            conversation={activeConversation}
            onBack={() => setShowSidebar(true)}
            onStartCall={handleStartCall}
            onConversationUpdate={handleConversationUpdate}
          />
          </Suspense>
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
        <Suspense fallback={null}>
        <VideoCall
          targetUserId={callTarget.userId}
          targetName={callTarget.name}
          conversationId={callTarget.conversationId}
          isInitiator={callTarget.isInitiator}
          onEnd={handleEndCall}
          minimized={callMinimized}
          onToggleMinimize={() => setCallMinimized((m) => !m)}
        />
        </Suspense>
      )}

      {incomingCall && !callTarget && (
        <Suspense fallback={null}>
        <IncomingCallModal onAccept={handleAcceptCall} />
        </Suspense>
      )}

      {storyViewData && (
        <Suspense fallback={<div className="loading-screen"><div className="loading-spinner" /></div>}>
        <StoryViewer
          storyUsers={storyViewData.users}
          startUserIdx={storyViewData.startIdx}
          onClose={() => setStoryViewData(null)}
        />
        </Suspense>
      )}

      {showStoryUpload && (
        <Suspense fallback={<div className="loading-screen"><div className="loading-spinner" /></div>}>
        <StoryUpload
          onClose={() => setShowStoryUpload(false)}
          onPublished={() => setStoryRefresh((k) => k + 1)}
        />
        </Suspense>
      )}
    </div>
  );
}
