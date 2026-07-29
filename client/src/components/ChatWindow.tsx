import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { playNotificationSound } from '../context/SocketContext';
import EmojiPicker from './EmojiPicker';
import {
  ArrowLeft, Video, Send, Check, CheckCheck, Mic, Square,
  Smile, Paperclip, X, Reply, Trash2, Play, Pause, Image, FileText,
} from 'lucide-react';
import type { Conversation, Message } from '../types';
import { formatMoscowClockTime, formatMoscowDateLabel, formatMoscowLastSeen } from '../utils/moscowTime';

interface Props {
  conversation: Conversation;
  onBack: () => void;
  onStartCall: (userId: string, name: string, conversationId: string) => void;
  onConversationUpdate: () => void;
}

type OutgoingMessagePayload = {
  conversationId: string;
  text?: string;
  type?: Message['type'];
  fileUrl?: string;
  fileName?: string;
  duration?: number;
  replyToId?: string | null;
  clientMessageId?: string;
};

type MessageSendAck = {
  ok: boolean;
  message?: Message;
  error?: string;
};

function pickVoiceMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = [
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ];

  return candidates.find((mime) => MediaRecorder.isTypeSupported(mime));
}

function extensionFromMimeType(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'm4a';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('wav')) return 'wav';
  return 'webm';
}

export default function ChatWindow({ conversation, onBack, onStartCall, onConversationUpdate }: Props) {
  const { user, token } = useAuth();
  const { socket } = useSocket();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [peerTyping, setPeerTyping] = useState(false);
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(null);
  const [participantPresence, setParticipantPresence] = useState<{
    status?: string;
    lastSeen?: string;
  }>({
    status: conversation.participant?.status,
    lastSeen: conversation.participant?.lastSeen,
  });

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<number>();
  const recordingTimeRef = useRef(0);
  const typingTimerRef = useRef<number>();
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());

  useEffect(() => {
    setParticipantPresence({
      status: conversation.participant?.status,
      lastSeen: conversation.participant?.lastSeen,
    });
  }, [conversation.id, conversation.participant?.status, conversation.participant?.lastSeen]);

  const pushMessage = useCallback((nextMessage: Message, replaceId?: string) => {
    setMessages((prev) => {
      const withoutReplaced = replaceId ? prev.filter((m) => m.id !== replaceId) : prev;
      const withoutDuplicate = withoutReplaced.filter((m) => m.id !== nextMessage.id);
      return [...withoutDuplicate, nextMessage].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
    });
  }, []);

  const fetchMessages = useCallback(async () => {
    const res = await fetch(`/api/conversations/${conversation.id}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setMessages(await res.json());
      onConversationUpdate();
      // Tell the sender immediately that messages are read on open.
      socket?.emit('message:read', { conversationId: conversation.id });
    }
  }, [conversation.id, token, onConversationUpdate, socket]);

  useEffect(() => {
    fetchMessages();
    socket?.emit('conversation:join', conversation.id);
    return () => {
      socket?.emit('typing:stop', { conversationId: conversation.id });
    };
  }, [conversation.id, fetchMessages, socket]);

  useEffect(() => {
    if (!socket) return;

    const handleNewMessage = (msg: Message) => {
      if (msg.conversationId === conversation.id) {
        pushMessage(msg);
        if (msg.senderId !== user?.id) {
          socket.emit('message:read', { conversationId: conversation.id });
          playNotificationSound();
        }
        onConversationUpdate();
      }
    };

    const handleRead = (data: { conversationId: string; readBy: string }) => {
      if (data.conversationId === conversation.id && data.readBy !== user?.id) {
        setMessages((prev) => prev.map((m) => (m.senderId === user?.id ? { ...m, read: true } : m)));
      }
    };

    const handleDeleted = (data: { messageId: string; conversationId: string }) => {
      if (data.conversationId === conversation.id) {
        setMessages((prev) => prev.filter((m) => m.id !== data.messageId));
      }
    };

    const handleTypingStart = (data: { conversationId: string; userId: string }) => {
      if (data.conversationId === conversation.id && data.userId !== user?.id) {
        setPeerTyping(true);
      }
    };

    const handleTypingStop = (data: { conversationId: string; userId: string }) => {
      if (data.conversationId === conversation.id && data.userId !== user?.id) {
        setPeerTyping(false);
      }
    };

    const handleUserStatus = (data: { userId: string; status: string; lastSeen?: string | null }) => {
      if (data.userId !== conversation.participant?.id) return;
      setParticipantPresence({
        status: data.status,
        lastSeen: data.lastSeen || undefined,
      });
    };

    socket.on('message:new', handleNewMessage);
    socket.on('message:read', handleRead);
    socket.on('message:deleted', handleDeleted);
    socket.on('typing:start', handleTypingStart);
    socket.on('typing:stop', handleTypingStop);
    socket.on('user:status', handleUserStatus);

    return () => {
      socket.off('message:new', handleNewMessage);
      socket.off('message:read', handleRead);
      socket.off('message:deleted', handleDeleted);
      socket.off('typing:start', handleTypingStart);
      socket.off('typing:stop', handleTypingStop);
      socket.off('user:status', handleUserStatus);
    };
  }, [socket, conversation.id, conversation.participant?.id, user?.id, onConversationUpdate, pushMessage]);

  useEffect(() => {
    if (!socket) return;
    const syncAfterReconnect = () => {
      socket.emit('conversation:join', conversation.id);
      fetchMessages();
    };
    const clearTyping = () => setPeerTyping(false);
    socket.on('connect', syncAfterReconnect);
    socket.on('disconnect', clearTyping);
    return () => {
      socket.off('connect', syncAfterReconnect);
      socket.off('disconnect', clearTyping);
    };
  }, [socket, conversation.id, fetchMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, peerTyping]);

  // Keep the latest messages visible when the keyboard opens/resizes the chat.
  useEffect(() => {
    const scrollLatest = () => {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    };
    const onViewport = () => {
      requestAnimationFrame(scrollLatest);
    };
    window.visualViewport?.addEventListener('resize', onViewport);
    window.visualViewport?.addEventListener('scroll', onViewport);
    window.addEventListener('resize', onViewport);
    return () => {
      window.visualViewport?.removeEventListener('resize', onViewport);
      window.visualViewport?.removeEventListener('scroll', onViewport);
      window.removeEventListener('resize', onViewport);
    };
  }, [conversation.id]);

  // --- Typing indicator ---
  const handleTextChange = (value: string) => {
    setText(value);
    if (!socket) return;
    socket.emit('typing:start', { conversationId: conversation.id });
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(() => {
      socket.emit('typing:stop', { conversationId: conversation.id });
    }, 2000);
  };

  const sendMessageViaHttp = useCallback(async (payload: OutgoingMessagePayload) => {
    if (!token) throw new Error('Нет авторизации');
    const res = await fetch(`/api/conversations/${conversation.id}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || 'Не удалось отправить сообщение');
    return data as Message;
  }, [conversation.id, token]);

  const emitMessage = useCallback(async (payload: Omit<OutgoingMessagePayload, 'conversationId' | 'clientMessageId'>) => {
    const canUseSocket = !!socket && socket.connected;
    if (!canUseSocket && !token) throw new Error('Нет подключения к серверу');

    const now = new Date().toISOString();
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const outgoingPayload: OutgoingMessagePayload = {
      ...payload,
      conversationId: conversation.id,
      replyToId: payload.replyToId || null,
      clientMessageId: tempId,
    };
    const optimistic: Message = {
      id: tempId,
      conversationId: conversation.id,
      senderId: user?.id || 'self',
      type: payload.type || 'text',
      text: payload.text || '',
      fileUrl: payload.fileUrl || null,
      fileName: payload.fileName || null,
      duration: payload.duration || null,
      replyToId: payload.replyToId || null,
      createdAt: now,
      read: false,
    };
    pushMessage(optimistic);
    onConversationUpdate();

    const removeOptimistic = () => {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
    };

    const trySocketSend = () => new Promise<Message>((resolve, reject) => {
      if (!socket) {
        reject(new Error('Нет подключения к серверу'));
        return;
      }
      let settled = false;
      const timeoutId = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Таймаут сокета'));
      }, 7000);

      socket.emit(
        'message:send',
        outgoingPayload,
        (ack?: MessageSendAck) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          if (ack?.ok && ack.message) {
            resolve(ack.message);
            return;
          }
          reject(new Error(ack?.error || 'Не удалось отправить сообщение'));
        }
      );
    });

    try {
      let persisted: Message;
      if (canUseSocket) {
        try {
          persisted = await trySocketSend();
        } catch {
          persisted = await sendMessageViaHttp(outgoingPayload);
        }
      } else {
        persisted = await sendMessageViaHttp(outgoingPayload);
      }
      pushMessage(persisted, tempId);
    } catch (error) {
      removeOptimistic();
      throw error;
    }
  }, [socket, token, conversation.id, user?.id, pushMessage, onConversationUpdate, sendMessageViaHttp]);

  // --- Send text message ---
  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    if (socket) socket.emit('typing:stop', { conversationId: conversation.id });
    setText('');
    const currentReplyTo = replyTo;
    setShowEmoji(false);
    inputRef.current?.focus();
    try {
      await emitMessage({
        text: value,
        type: 'text',
        replyToId: currentReplyTo?.id || null,
      });
      setReplyTo(null);
    } catch (error: any) {
      setText(value);
      alert(error?.message || 'Не удалось отправить сообщение');
    }
  };

  // --- File upload ---
  const uploadFile = async (file: File): Promise<{ fileUrl: string; fileName: string; mimeType: string } | null> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (res.ok) return res.json();
    return null;
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const currentReplyToId = replyTo?.id || null;
    for (const file of Array.from(files)) {
      const result = await uploadFile(file);
      if (result) {
        let type: Message['type'] = 'file';
        if (file.type.startsWith('image/')) type = 'image';
        else if (file.type.startsWith('video/')) type = 'video';

        try {
          await emitMessage({
            type,
            text: '',
            fileUrl: result.fileUrl,
            fileName: result.fileName,
            replyToId: currentReplyToId,
          });
        } catch (error: any) {
          alert(error?.message || 'Не удалось отправить файл');
        }
      }
    }
    setReplyTo(null);
    e.target.value = '';
  };

  // --- Voice recording ---
  const startRecording = async () => {
    try {
      if (typeof MediaRecorder === 'undefined') {
        alert('Голосовые сообщения не поддерживаются на этом устройстве');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredMime = pickVoiceMimeType();
      const mr = preferredMime ? new MediaRecorder(stream, { mimeType: preferredMime }) : new MediaRecorder(stream);
      audioChunksRef.current = [];
      recordingTimeRef.current = 0;
      setRecordingTime(0);
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const voiceMimeType = mr.mimeType || preferredMime || 'audio/webm';
        const extension = extensionFromMimeType(voiceMimeType);
        const blob = new Blob(audioChunksRef.current, { type: voiceMimeType });
        const file = new File([blob], `voice.${extension}`, { type: voiceMimeType });
        const result = await uploadFile(file);
        if (result) {
          try {
            await emitMessage({
              type: 'voice',
              text: '',
              fileUrl: result.fileUrl,
              fileName: 'Голосовое сообщение',
              duration: recordingTimeRef.current,
              replyToId: replyTo?.id || null,
            });
            setReplyTo(null);
          } catch (error: any) {
            alert(error?.message || 'Не удалось отправить голосовое сообщение');
          }
        }
        recordingTimeRef.current = 0;
        setRecordingTime(0);
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setIsRecording(true);
      recTimerRef.current = window.setInterval(() => {
        setRecordingTime((t) => {
          const next = t + 1;
          recordingTimeRef.current = next;
          return next;
        });
      }, 1000);
    } catch {
      alert('Не удалось получить доступ к микрофону');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (recTimerRef.current) clearInterval(recTimerRef.current);
    setIsRecording(false);
    recordingTimeRef.current = 0;
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = () => {};
      mediaRecorderRef.current.stop();
    }
    if (recTimerRef.current) clearInterval(recTimerRef.current);
    setIsRecording(false);
    recordingTimeRef.current = 0;
    setRecordingTime(0);
  };

  // --- Voice playback ---
  const toggleVoice = (msgId: string, url: string) => {
    if (!url) return;
    const fullUrl = url.startsWith('http') ? url : `${window.location.origin}${url.startsWith('/') ? '' : '/'}${url}`;

    if (playingVoice && playingVoice !== msgId) {
      const prev = audioRefs.current.get(playingVoice);
      if (prev) prev.pause();
    }

    const existing = audioRefs.current.get(msgId);
    if (existing) {
      if (playingVoice === msgId) {
        existing.pause();
        setPlayingVoice(null);
      } else {
        existing.play().catch(() => setPlayingVoice(null));
        setPlayingVoice(msgId);
      }
      return;
    }
    const audio = new Audio(fullUrl);
    audioRefs.current.set(msgId, audio);
    audio.onended = () => setPlayingVoice(null);
    audio.onerror = () => setPlayingVoice(null);
    audio.play().catch(() => setPlayingVoice(null));
    setPlayingVoice(msgId);
  };

  // --- Delete message ---
  const deleteMessage = async (msgId: string) => {
    await fetch(`/api/messages/${msgId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  };

  const handleCall = () => {
    if (!conversation.participant) return;
    onStartCall(conversation.participant.id, conversation.participant.displayName, conversation.id);
  };

  const formatTime = (dateStr: string) => formatMoscowClockTime(dateStr);

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const messageGroups = useMemo(() => {
    const groups: { date: string; messages: Message[] }[] = [];
    let currentDate = '';
    messages.forEach((msg) => {
      const date = formatMoscowDateLabel(msg.createdAt);
      if (date !== currentDate) {
        currentDate = date;
        groups.push({ date, messages: [msg] });
      } else {
        groups[groups.length - 1].messages.push(msg);
      }
    });
    return groups;
  }, [messages]);

  const getReplyMessage = (id: string | null) => id ? messages.find((m) => m.id === id) : null;

  const participant = conversation.participant;

  const renderMessageContent = (msg: Message) => {
    const reply = getReplyMessage(msg.replyToId);

    return (
      <div className="message-bubble">
        {reply && (
          <div className="reply-preview">
            <span className="reply-author">
              {reply.senderId === user?.id ? 'Вы' : participant?.displayName}
            </span>
            <span className="reply-text">
              {reply.type === 'voice' ? '🎤 Голосовое' : reply.type === 'image' ? '📷 Фото' : reply.text}
            </span>
          </div>
        )}

        {msg.type === 'text' && <p className="message-text">{msg.text}</p>}

        {msg.type === 'voice' && msg.fileUrl && (
          <div className="voice-message" onClick={() => toggleVoice(msg.id, msg.fileUrl!)}>
            <button className="voice-play-btn">
              {playingVoice === msg.id ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <div className="voice-waves">
              {Array.from({ length: 20 }, (_, i) => (
                <div key={i} className="voice-bar" style={{ height: `${12 + ((msg.id.charCodeAt(i % msg.id.length) % 18) + 1)}px` }} />
              ))}
            </div>
            <span className="voice-duration">{formatDuration(msg.duration || 0)}</span>
          </div>
        )}

        {msg.type === 'image' && (
          <div className="image-message">
            <img src={msg.fileUrl!} alt="" loading="lazy" onClick={() => window.open(msg.fileUrl!, '_blank')} />
          </div>
        )}

        {msg.type === 'video' && (
          <div className="video-message">
            <video src={msg.fileUrl!} controls preload="metadata" />
          </div>
        )}

        {msg.type === 'file' && (
          <a href={msg.fileUrl!} target="_blank" rel="noopener" className="file-message">
            <FileText size={20} />
            <span>{msg.fileName || 'Файл'}</span>
          </a>
        )}

        <div className="message-meta">
          <span className="message-time">{formatTime(msg.createdAt)}</span>
          {msg.senderId === user?.id && (
            <span className={`message-status ${msg.read ? 'read' : 'unread'}`}>
              {msg.read ? <CheckCheck size={14} /> : <Check size={14} />}
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="chat-window">
      <div className="chat-header">
        <button className="icon-btn back-btn" onClick={onBack}>
          <ArrowLeft size={20} />
        </button>
        <div className="avatar" style={{ background: participant?.avatarColor || '#999' }}>
          {participant?.displayName?.[0]?.toUpperCase() || '?'}
          {participantPresence.status === 'online' && <span className="online-dot" />}
        </div>
        <div className="chat-header-info">
          <span className="chat-header-name">{participant?.displayName || 'Пользователь'}</span>
          <span className="chat-header-status">
            {peerTyping
              ? 'печатает...'
              : participantPresence.status === 'online'
                ? 'в сети'
                : participantPresence.lastSeen
                  ? `был(а) ${formatMoscowLastSeen(participantPresence.lastSeen)}`
                  : 'не в сети'}
          </span>
        </div>
        <button className="icon-btn call-btn" onClick={handleCall} title="Видеозвонок">
          <Video size={20} />
        </button>
      </div>

      <div className="chat-messages">
        {messageGroups.map((group) => (
          <div key={group.date} className="date-group">
            <div className="date-separator"><span>{group.date}</span></div>
            {group.messages.map((msg) => (
              <div
                key={msg.id}
                className={`message ${msg.senderId === user?.id ? 'sent' : 'received'} ${selectedMsgId === msg.id ? 'selected' : ''}`}
                onClick={() => setSelectedMsgId(selectedMsgId === msg.id ? null : msg.id)}
              >
                {renderMessageContent(msg)}
                <div className="message-actions">
                  <button onClick={(e) => { e.stopPropagation(); setReplyTo(msg); setSelectedMsgId(null); }} title="Ответить"><Reply size={14} /></button>
                  {msg.senderId === user?.id && (
                    <button onClick={(e) => { e.stopPropagation(); deleteMessage(msg.id); setSelectedMsgId(null); }} title="Удалить"><Trash2 size={14} /></button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
        {peerTyping && (
          <div className="typing-indicator">
            <span /><span /><span />
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {replyTo && (
        <div className="reply-bar">
          <Reply size={16} />
          <div className="reply-bar-content">
            <span className="reply-bar-author">
              {replyTo.senderId === user?.id ? 'Вы' : participant?.displayName}
            </span>
            <span className="reply-bar-text">
              {replyTo.type === 'voice' ? '🎤 Голосовое' : replyTo.type === 'image' ? '📷 Фото' : replyTo.text}
            </span>
          </div>
          <button className="icon-btn" onClick={() => setReplyTo(null)}><X size={16} /></button>
        </div>
      )}

      {showEmoji && (
        <EmojiPicker
          onSelect={(emoji) => setText((prev) => prev + emoji)}
          onClose={() => setShowEmoji(false)}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*,audio/*,.pdf"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />

      {isRecording ? (
        <div className="chat-input-area recording">
          <div className="recording-indicator">
            <span className="rec-dot" />
            <span className="rec-time">{formatDuration(recordingTime)}</span>
          </div>
          <button className="icon-btn" onClick={cancelRecording} title="Отмена">
            <X size={20} />
          </button>
          <button className="send-btn" onClick={stopRecording} title="Отправить">
            <Send size={20} />
          </button>
        </div>
      ) : (
        <form className="chat-input-area" onSubmit={sendMessage}>
          <button type="button" className="icon-btn" onClick={() => setShowEmoji(!showEmoji)} title="Эмодзи">
            <Smile size={20} />
          </button>
          <button type="button" className="icon-btn" onClick={() => fileInputRef.current?.click()} title="Прикрепить">
            <Paperclip size={20} />
          </button>
          <input
            ref={inputRef}
            type="text"
            placeholder="Сообщение..."
            value={text}
            onChange={(e) => handleTextChange(e.target.value)}
          />
          {text.trim() ? (
            <button type="submit" className="send-btn">
              <Send size={20} />
            </button>
          ) : (
            <button type="button" className="send-btn mic-btn" onClick={startRecording} title="Голосовое">
              <Mic size={20} />
            </button>
          )}
        </form>
      )}
    </div>
  );
}
