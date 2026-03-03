import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { playNotificationSound } from '../context/SocketContext';
import EmojiPicker from './EmojiPicker';
import {
  ArrowLeft, Video, Send, Check, CheckCheck, Mic, Square,
  Smile, Paperclip, X, Reply, Trash2, Play, Pause, Image, FileText,
} from 'lucide-react';
import type { Conversation, Message } from '../types';

interface Props {
  conversation: Conversation;
  onBack: () => void;
  onStartCall: (userId: string, name: string, conversationId: string) => void;
  onConversationUpdate: () => void;
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

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<number>();
  const typingTimerRef = useRef<number>();
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());

  const fetchMessages = useCallback(async () => {
    const res = await fetch(`/api/conversations/${conversation.id}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setMessages(await res.json());
      onConversationUpdate();
    }
  }, [conversation.id, token, onConversationUpdate]);

  useEffect(() => {
    fetchMessages();
    socket?.emit('conversation:join', conversation.id);
    inputRef.current?.focus();
    return () => {
      socket?.emit('typing:stop', { conversationId: conversation.id });
    };
  }, [conversation.id, fetchMessages, socket]);

  useEffect(() => {
    if (!socket) return;

    const handleNewMessage = (msg: Message) => {
      if (msg.conversationId === conversation.id) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
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

    socket.on('message:new', handleNewMessage);
    socket.on('message:read', handleRead);
    socket.on('message:deleted', handleDeleted);
    socket.on('typing:start', handleTypingStart);
    socket.on('typing:stop', handleTypingStop);

    return () => {
      socket.off('message:new', handleNewMessage);
      socket.off('message:read', handleRead);
      socket.off('message:deleted', handleDeleted);
      socket.off('typing:start', handleTypingStart);
      socket.off('typing:stop', handleTypingStop);
    };
  }, [socket, conversation.id, user?.id, onConversationUpdate]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, peerTyping]);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'instant' });
      });
    };
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);

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

  // --- Send text message ---
  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || !socket) return;
    socket.emit('typing:stop', { conversationId: conversation.id });
    socket.emit('message:send', {
      conversationId: conversation.id,
      text: text.trim(),
      type: 'text',
      replyToId: replyTo?.id || null,
    });
    setText('');
    setReplyTo(null);
    setShowEmoji(false);
    inputRef.current?.focus();
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
    if (!files || !socket) return;

    for (const file of Array.from(files)) {
      const result = await uploadFile(file);
      if (result) {
        let type: Message['type'] = 'file';
        if (file.type.startsWith('image/')) type = 'image';
        else if (file.type.startsWith('video/')) type = 'video';

        socket.emit('message:send', {
          conversationId: conversation.id,
          type,
          text: '',
          fileUrl: result.fileUrl,
          fileName: result.fileName,
          replyToId: replyTo?.id || null,
        });
        setReplyTo(null);
      }
    }
    e.target.value = '';
  };

  // --- Voice recording ---
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const file = new File([blob], 'voice.webm', { type: 'audio/webm' });
        const result = await uploadFile(file);
        if (result && socket) {
          socket.emit('message:send', {
            conversationId: conversation.id,
            type: 'voice',
            text: '',
            fileUrl: result.fileUrl,
            fileName: 'Голосовое сообщение',
            duration: recordingTime,
          });
        }
        setRecordingTime(0);
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setIsRecording(true);
      recTimerRef.current = window.setInterval(() => {
        setRecordingTime((t) => t + 1);
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
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = () => {};
      mediaRecorderRef.current.stop();
    }
    if (recTimerRef.current) clearInterval(recTimerRef.current);
    setIsRecording(false);
    setRecordingTime(0);
  };

  // --- Voice playback ---
  const toggleVoice = (msgId: string, url: string) => {
    const existing = audioRefs.current.get(msgId);
    if (existing) {
      if (playingVoice === msgId) {
        existing.pause();
        setPlayingVoice(null);
      } else {
        existing.play();
        setPlayingVoice(msgId);
      }
      return;
    }
    const audio = new Audio(url);
    audioRefs.current.set(msgId, audio);
    audio.onended = () => setPlayingVoice(null);
    audio.play();
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

  const formatTime = (dateStr: string) =>
    new Date(dateStr).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const groupMessagesByDate = (msgs: Message[]) => {
    const groups: { date: string; messages: Message[] }[] = [];
    let currentDate = '';
    msgs.forEach((msg) => {
      const date = new Date(msg.createdAt).toLocaleDateString('ru', {
        day: 'numeric', month: 'long', year: 'numeric',
      });
      if (date !== currentDate) {
        currentDate = date;
        groups.push({ date, messages: [msg] });
      } else {
        groups[groups.length - 1].messages.push(msg);
      }
    });
    return groups;
  };

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

        {msg.type === 'voice' && (
          <div className="voice-message" onClick={() => toggleVoice(msg.id, msg.fileUrl!)}>
            <button className="voice-play-btn">
              {playingVoice === msg.id ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <div className="voice-waves">
              {Array.from({ length: 20 }, (_, i) => (
                <div key={i} className="voice-bar" style={{ height: `${12 + Math.random() * 18}px` }} />
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
            <span className="message-status">
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
          {participant?.status === 'online' && <span className="online-dot" />}
        </div>
        <div className="chat-header-info">
          <span className="chat-header-name">{participant?.displayName || 'Пользователь'}</span>
          <span className="chat-header-status">
            {peerTyping
              ? 'печатает...'
              : participant?.status === 'online'
                ? 'в сети'
                : participant?.lastSeen
                  ? `был(а) ${formatTime(participant.lastSeen)}`
                  : 'не в сети'}
          </span>
        </div>
        <button className="icon-btn call-btn" onClick={handleCall} title="Видеозвонок">
          <Video size={20} />
        </button>
      </div>

      <div className="chat-messages">
        {groupMessagesByDate(messages).map((group) => (
          <div key={group.date} className="date-group">
            <div className="date-separator"><span>{group.date}</span></div>
            {group.messages.map((msg) => (
              <div key={msg.id} className={`message ${msg.senderId === user?.id ? 'sent' : 'received'}`}>
                {renderMessageContent(msg)}
                <div className="message-actions">
                  <button onClick={() => setReplyTo(msg)} title="Ответить"><Reply size={14} /></button>
                  {msg.senderId === user?.id && (
                    <button onClick={() => deleteMessage(msg.id)} title="Удалить"><Trash2 size={14} /></button>
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
