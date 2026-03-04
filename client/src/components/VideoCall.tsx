import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import {
  PhoneOff, Mic, MicOff, Video, VideoOff, Sparkles, RotateCcw, Minimize2, Maximize2,
} from 'lucide-react';

interface Props {
  targetUserId: string;
  targetName: string;
  conversationId: string;
  isInitiator: boolean;
  onEnd: () => void;
  minimized?: boolean;
  onToggleMinimize?: () => void;
}

function buildIceConfig(): RTCConfiguration {
  const host = window.location.hostname;
  return {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      {
        urls: `turn:${host}:3478`,
        username: 'maktime',
        credential: 'MakTimeT0rn2026!',
      },
      {
        urls: `turn:${host}:3478?transport=tcp`,
        username: 'maktime',
        credential: 'MakTimeT0rn2026!',
      },
    ],
    iceCandidatePoolSize: 10,
    iceTransportPolicy: 'all',
  };
}

const VIDEO_FILTERS = [
  { name: 'Без фильтра', css: 'none' },
  { name: 'Тёплый', css: 'sepia(0.3) saturate(1.4) brightness(1.1)' },
  { name: 'Холодный', css: 'saturate(0.8) brightness(1.1) hue-rotate(15deg)' },
  { name: 'Ч/Б', css: 'grayscale(1) contrast(1.2)' },
  { name: 'Винтаж', css: 'sepia(0.6) contrast(0.9) brightness(1.1)' },
  { name: 'Яркий', css: 'saturate(1.8) contrast(1.1) brightness(1.05)' },
  { name: 'Ночь', css: 'brightness(0.7) contrast(1.3) saturate(0.6) hue-rotate(200deg)' },
  { name: 'Розовый', css: 'hue-rotate(320deg) saturate(1.3) brightness(1.1)' },
];

export default function VideoCall({ targetUserId, targetName, conversationId, isInitiator, onEnd, minimized, onToggleMinimize }: Props) {
  const { user } = useAuth();
  const { socket, setIncomingCall } = useSocket();
  const [status, setStatus] = useState(isInitiator ? 'calling' : 'connecting');
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [duration, setDuration] = useState(0);
  const [filterIdx, setFilterIdx] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [isFrontCamera, setIsFrontCamera] = useState(true);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number>();
  const callTimeoutRef = useRef<number>();
  const iceRestartCount = useRef(0);
  const iceCandidateQueue = useRef<RTCIceCandidateInit[]>([]);
  const hasRemoteDesc = useRef(false);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current = null;
    remoteStreamRef.current = null;
    hasRemoteDesc.current = false;
    iceRestartCount.current = 0;
    iceCandidateQueue.current = [];
    setIncomingCall(null);
  }, [setIncomingCall]);

  const endCall = useCallback(() => {
    socket?.emit('call:end', { to: targetUserId });
    cleanup();
    onEnd();
  }, [socket, targetUserId, cleanup, onEnd]);

  const processIceQueue = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || !hasRemoteDesc.current) return;
    while (iceCandidateQueue.current.length > 0) {
      const candidate = iceCandidateQueue.current.shift()!;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn('ICE candidate error:', e);
      }
    }
  }, []);

  useEffect(() => {
    if (!socket) return;

    let mounted = true;

    const setupCall = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: isFrontCamera ? 'user' : 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        if (!mounted) { stream.getTracks().forEach((t) => t.stop()); return; }

        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;

        const pc = new RTCPeerConnection(buildIceConfig());
        pcRef.current = pc;

        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        pc.ontrack = (event) => {
          if (event.streams[0]) {
            remoteStreamRef.current = event.streams[0];
            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = event.streams[0];
            }
          }
        };

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            socket.emit('webrtc:ice-candidate', { to: targetUserId, candidate: event.candidate });
          }
        };

        pc.oniceconnectionstatechange = () => {
          if (!mounted) return;
          const state = pc.iceConnectionState;
          console.log('[WebRTC] ICE connection state:', state);
          if (state === 'failed' && iceRestartCount.current < 3) {
            iceRestartCount.current++;
            console.log('[WebRTC] Restarting ICE, attempt:', iceRestartCount.current);
            pc.restartIce();
            if (isInitiator && pc.localDescription) {
              pc.createOffer({ iceRestart: true }).then((offer) => {
                pc.setLocalDescription(offer);
                socket.emit('webrtc:offer', { to: targetUserId, offer });
              }).catch((e) => console.error('[WebRTC] ICE restart offer error:', e));
            }
          }
        };

        pc.onconnectionstatechange = () => {
          if (!mounted) return;
          console.log('[WebRTC] Connection state:', pc.connectionState);
          if (pc.connectionState === 'connected') {
            if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);
            setStatus('connected');
            if (!timerRef.current) {
              timerRef.current = window.setInterval(() => setDuration((d) => d + 1), 1000);
            }
          } else if (pc.connectionState === 'failed') {
            if (iceRestartCount.current >= 3) endCall();
          } else if (pc.connectionState === 'disconnected') {
            setTimeout(() => {
              if (pcRef.current?.connectionState === 'disconnected') endCall();
            }, 5000);
          }
        };

        const createAndSendOffer = async () => {
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('webrtc:offer', { to: targetUserId, offer });
          } catch (e) { console.error('[WebRTC] Offer error:', e); }
        };

        if (isInitiator) {
          socket.emit('call:initiate', {
            to: targetUserId,
            conversationId,
            callerName: user?.displayName || '',
          });
          callTimeoutRef.current = window.setTimeout(() => {
            if (mounted && (status === 'calling' || status === 'connecting')) {
              setStatus('unavailable');
              setTimeout(() => { cleanup(); onEnd(); }, 2000);
            }
          }, 30000);
        } else {
          socket.emit('call:accept', { to: targetUserId });
        }

        socket.on('call:accepted', async (data: { from: string }) => {
          if (!mounted || data.from !== targetUserId) return;
          if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);
          setStatus('connecting');
          await createAndSendOffer();
        });

        socket.on('call:rejected', () => {
          if (!mounted) return;
          if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);
          setStatus('rejected');
          setTimeout(() => { cleanup(); onEnd(); }, 2000);
        });

        socket.on('webrtc:offer', async (data: { from: string; offer: RTCSessionDescriptionInit }) => {
          if (!mounted || data.from !== targetUserId) return;
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            hasRemoteDesc.current = true;
            await processIceQueue();
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('webrtc:answer', { to: targetUserId, answer });
          } catch (e) { console.error('[WebRTC] Answer error:', e); }
        });

        socket.on('webrtc:answer', async (data: { from: string; answer: RTCSessionDescriptionInit }) => {
          if (!mounted || data.from !== targetUserId) return;
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            hasRemoteDesc.current = true;
            await processIceQueue();
          } catch (e) { console.error('[WebRTC] Remote desc error:', e); }
        });

        socket.on('webrtc:ice-candidate', async (data: { from: string; candidate: RTCIceCandidateInit }) => {
          if (!mounted || data.from !== targetUserId) return;
          if (hasRemoteDesc.current) {
            try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); }
            catch (e) { console.warn('[WebRTC] ICE error:', e); }
          } else {
            iceCandidateQueue.current.push(data.candidate);
          }
        });

        socket.on('call:ended', () => { if (mounted) { cleanup(); onEnd(); } });
        socket.on('call:unavailable', () => {
          if (!mounted) return;
          if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);
          setStatus('unavailable');
          setTimeout(() => { cleanup(); onEnd(); }, 2000);
        });

      } catch (err) {
        console.error('[WebRTC] Call setup failed:', err);
        if (!mounted) return;
        setStatus('error');
        setTimeout(() => { cleanup(); onEnd(); }, 3000);
      }
    };

    setupCall();

    return () => {
      mounted = false;
      cleanup();
      socket.off('call:accepted');
      socket.off('call:rejected');
      socket.off('call:ended');
      socket.off('call:unavailable');
      socket.off('webrtc:offer');
      socket.off('webrtc:answer');
      socket.off('webrtc:ice-candidate');
    };
  }, []);

  const toggleMute = () => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) { track.enabled = !track.enabled; setIsMuted(!track.enabled); }
  };

  const toggleVideo = () => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (track) { track.enabled = !track.enabled; setIsVideoOff(!track.enabled); }
  };

  const switchCamera = async () => {
    const newFacing = !isFrontCamera;
    try {
      const oldTrack = localStreamRef.current?.getVideoTracks()[0];
      if (oldTrack) {
        oldTrack.stop();
        localStreamRef.current?.removeTrack(oldTrack);
      }

      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { exact: newFacing ? 'user' : 'environment' } },
        audio: false,
      });
      const newTrack = newStream.getVideoTracks()[0];

      const pc = pcRef.current;
      if (pc) {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) await sender.replaceTrack(newTrack);
      }

      localStreamRef.current?.addTrack(newTrack);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
        localVideoRef.current.srcObject = localStreamRef.current;
      }
      setIsFrontCamera(newFacing);
    } catch (e) {
      console.warn('[WebRTC] Camera switch failed:', e);
      try {
        const fallback = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: newFacing ? 'user' : 'environment' },
          audio: false,
        });
        const fallbackTrack = fallback.getVideoTracks()[0];
        const pc = pcRef.current;
        if (pc) {
          const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
          if (sender) await sender.replaceTrack(fallbackTrack);
        }
        localStreamRef.current?.addTrack(fallbackTrack);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = null;
          localVideoRef.current.srcObject = localStreamRef.current;
        }
        setIsFrontCamera(newFacing);
      } catch {}
    }
  };

  const formatDur = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const statusText: Record<string, string> = {
    calling: 'Вызов...', connecting: 'Подключение...', connected: formatDur(duration),
    rejected: 'Вызов отклонён', unavailable: 'Абонент недоступен', error: 'Ошибка соединения',
  };

  const currentFilter = VIDEO_FILTERS[filterIdx].css;

  return (
    <div
      className={`video-call-overlay ${minimized ? 'pip-mode' : ''}`}
      onClick={minimized ? onToggleMinimize : undefined}
    >
      <div className="video-call">
        <video
          ref={remoteVideoRef}
          className="remote-video"
          autoPlay playsInline
          style={!minimized ? { filter: currentFilter } : undefined}
        />

        {!minimized && (
          <div className="call-top-bar">
            <span className="call-name">{targetName}</span>
            <span className="call-status">{statusText[status]}</span>
          </div>
        )}

        {minimized && (
          <div className="pip-info">
            <span className="pip-name">{targetName}</span>
            <span className="pip-status">{statusText[status]}</span>
          </div>
        )}

        <video
          ref={localVideoRef}
          className="local-video"
          autoPlay playsInline muted
          style={!minimized ? { filter: currentFilter, transform: isFrontCamera ? 'scaleX(-1)' : 'none' } : undefined}
        />

        {!minimized && showFilters && (
          <div className="filter-panel">
            {VIDEO_FILTERS.map((f, i) => (
              <button
                key={i}
                className={`filter-btn ${filterIdx === i ? 'active' : ''}`}
                onClick={() => { setFilterIdx(i); setShowFilters(false); }}
              >
                {f.name}
              </button>
            ))}
          </div>
        )}

        {minimized ? (
          <div className="pip-actions" onClick={(e) => e.stopPropagation()}>
            <button className={`pip-btn ${isMuted ? 'active' : ''}`} onClick={toggleMute}>
              {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
            <button className="pip-btn end" onClick={endCall}>
              <PhoneOff size={16} />
            </button>
            <button className="pip-btn" onClick={onToggleMinimize}>
              <Maximize2 size={16} />
            </button>
          </div>
        ) : (
          <div className="call-controls">
            <button className={`call-control-btn ${isMuted ? 'active' : ''}`} onClick={toggleMute}>
              {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
            </button>
            <button className={`call-control-btn ${isVideoOff ? 'active' : ''}`} onClick={toggleVideo}>
              {isVideoOff ? <VideoOff size={24} /> : <Video size={24} />}
            </button>
            <button className="call-control-btn" onClick={switchCamera} title="Сменить камеру">
              <RotateCcw size={24} />
            </button>
            <button className="call-control-btn" onClick={() => setShowFilters(!showFilters)} title="Эффекты">
              <Sparkles size={24} />
            </button>
            {onToggleMinimize && (
              <button className="call-control-btn" onClick={onToggleMinimize} title="Свернуть">
                <Minimize2 size={24} />
              </button>
            )}
            <button className="call-control-btn end-call" onClick={endCall}>
              <PhoneOff size={24} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
