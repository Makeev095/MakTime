import { useState, useEffect, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { CallAudio } from '../plugins/CallAudio';
import { PhoneOff, Mic, MicOff, Volume2, Ear } from 'lucide-react';

interface Props {
  targetUserId: string;
  targetName: string;
  conversationId: string;
  isInitiator: boolean;
  onEnd: () => void;
}

type AudioRoute = 'speaker' | 'earpiece';

function buildFallbackIceConfig(): RTCConfiguration {
  const host = window.location.hostname || 'maktalk.ru';
  const turnHosts = host === 'maktalk.ru' ? [host] : [host, 'maktalk.ru'];
  const turnServers = turnHosts.flatMap((turnHost) => ([
    {
      urls: `turn:${turnHost}:3478`,
      username: 'maktime',
      credential: 'MakTimeT0rn2026!',
    },
    {
      urls: `turn:${turnHost}:3478?transport=tcp`,
      username: 'maktime',
      credential: 'MakTimeT0rn2026!',
    },
  ]));
  return {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      ...turnServers,
    ],
    iceCandidatePoolSize: 10,
    iceTransportPolicy: 'all',
  };
}

async function loadIceConfig(token: string | null): Promise<RTCConfiguration> {
  const fallback = buildFallbackIceConfig();
  if (!token) return fallback;
  try {
    const res = await fetch('/api/webrtc/config', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return fallback;
    const data = await res.json() as { iceServers?: RTCIceServer[] };
    if (!Array.isArray(data.iceServers) || data.iceServers.length === 0) return fallback;
    return {
      iceServers: data.iceServers,
      iceCandidatePoolSize: 10,
      iceTransportPolicy: 'all',
    };
  } catch {
    return fallback;
  }
}

async function startNativeCallAudio(speaker: boolean) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    if (Capacitor.isPluginAvailable('CallAudio')) {
      await CallAudio.startCallAudio({ speaker });
    }
  } catch (error) {
    console.warn('[WebRTC] CallAudio start failed:', error);
  }
}

async function setNativeSpeaker(enabled: boolean) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    if (Capacitor.isPluginAvailable('CallAudio')) {
      await CallAudio.setSpeaker({ enabled });
    }
  } catch (error) {
    console.warn('[WebRTC] CallAudio setSpeaker failed:', error);
  }
}

async function stopNativeCallAudio() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    if (Capacitor.isPluginAvailable('CallAudio')) {
      await CallAudio.stopCallAudio();
    }
  } catch {
    /* ignore */
  }
}

export default function VideoCall({
  targetUserId, targetName, conversationId, isInitiator, onEnd,
}: Props) {
  const { user, token } = useAuth();
  const { socket, setIncomingCall } = useSocket();
  const [status, setStatus] = useState(isInitiator ? 'calling' : 'connecting');
  const [isMuted, setIsMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioRoute, setAudioRoute] = useState<AudioRoute>('speaker');

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number>();
  const callTimeoutRef = useRef<number>();
  const iceRestartCount = useRef(0);
  const iceCandidateQueue = useRef<RTCIceCandidateInit[]>([]);
  const pendingOffer = useRef<RTCSessionDescriptionInit | null>(null);
  const pendingAnswer = useRef<RTCSessionDescriptionInit | null>(null);
  const hasRemoteDesc = useRef(false);

  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const endCallRef = useRef<() => void>(() => {});
  const endCall = useCallback(() => { endCallRef.current(); }, []);

  useEffect(() => {
    if (!socket) return;

    let mounted = true;
    let ended = false;

    const doClean = () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = undefined;
      if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      pcRef.current?.close();
      pcRef.current = null;
      localStreamRef.current = null;
      remoteStreamRef.current = null;
      hasRemoteDesc.current = false;
      iceRestartCount.current = 0;
      iceCandidateQueue.current = [];
      pendingOffer.current = null;
      pendingAnswer.current = null;
      void stopNativeCallAudio();
    };

    const doEnd = () => {
      if (ended) return;
      ended = true;
      socket.emit('call:end', { to: targetUserId });
      removeListeners();
      doClean();
      setIncomingCall(null);
      onEndRef.current();
    };

    const doEndRemote = () => {
      if (ended) return;
      ended = true;
      removeListeners();
      doClean();
      setIncomingCall(null);
      onEndRef.current();
    };

    endCallRef.current = doEnd;

    const processQueue = async (pc: RTCPeerConnection) => {
      if (!hasRemoteDesc.current) return;
      while (iceCandidateQueue.current.length > 0) {
        const c = iceCandidateQueue.current.shift()!;
        try { await pc.addIceCandidate(new RTCIceCandidate(c)); }
        catch (e) { console.warn('[WebRTC] ICE candidate error:', e); }
      }
    };

    const applyOffer = async (offer: RTCSessionDescriptionInit) => {
      const pc = pcRef.current;
      if (!pc) {
        pendingOffer.current = offer;
        return;
      }
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        hasRemoteDesc.current = true;
        await processQueue(pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('webrtc:answer', { to: targetUserId, answer });
      } catch (e) {
        console.error('[WebRTC] Answer error:', e);
      }
    };

    const applyAnswer = async (answer: RTCSessionDescriptionInit) => {
      const pc = pcRef.current;
      if (!pc) {
        pendingAnswer.current = answer;
        return;
      }
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        hasRemoteDesc.current = true;
        await processQueue(pc);
      } catch (e) {
        console.error('[WebRTC] Remote desc error:', e);
      }
    };

    const onAccepted = async (data: { from: string }) => {
      if (!mounted || data.from !== targetUserId) return;
      if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);
      setStatus('connecting');
      const pc = pcRef.current;
      if (!pc) return;
      try {
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });
        await pc.setLocalDescription(offer);
        socket.emit('webrtc:offer', { to: targetUserId, offer });
      } catch (e) { console.error('[WebRTC] Offer error:', e); }
    };

    const onRejected = () => {
      if (!mounted) return;
      if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);
      setStatus('rejected');
      setTimeout(() => doEndRemote(), 2000);
    };

    const onOffer = async (data: { from: string; offer: RTCSessionDescriptionInit }) => {
      if (!mounted || data.from !== targetUserId) return;
      await applyOffer(data.offer);
    };

    const onAnswer = async (data: { from: string; answer: RTCSessionDescriptionInit }) => {
      if (!mounted || data.from !== targetUserId) return;
      await applyAnswer(data.answer);
    };

    const onIce = async (data: { from: string; candidate: RTCIceCandidateInit }) => {
      if (!mounted || data.from !== targetUserId) return;
      const pc = pcRef.current;
      if (!pc) {
        iceCandidateQueue.current.push(data.candidate);
        return;
      }
      if (hasRemoteDesc.current) {
        try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); }
        catch (e) { console.warn('[WebRTC] ICE error:', e); }
      } else {
        iceCandidateQueue.current.push(data.candidate);
      }
    };

    const onEnded = () => { if (mounted) doEndRemote(); };

    const onUnavailable = () => {
      if (!mounted) return;
      if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);
      setStatus('unavailable');
      setTimeout(() => doEndRemote(), 2000);
    };

    const removeListeners = () => {
      socket.off('call:accepted', onAccepted);
      socket.off('call:rejected', onRejected);
      socket.off('webrtc:offer', onOffer);
      socket.off('webrtc:answer', onAnswer);
      socket.off('webrtc:ice-candidate', onIce);
      socket.off('call:ended', onEnded);
      socket.off('call:unavailable', onUnavailable);
    };

    const setupCall = async () => {
      try {
        if (!window.isSecureContext && window.location.hostname !== 'localhost') {
          setStatus('insecure');
          setTimeout(() => doEndRemote(), 2500);
          return;
        }

        // Loudspeaker by default — critical for iOS WKWebView WebRTC audio.
        await startNativeCallAudio(true);
        setAudioRoute('speaker');

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (!mounted) { stream.getTracks().forEach((t) => t.stop()); return; }

        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          localVideoRef.current.play().catch(() => {});
        }

        const pc = new RTCPeerConnection(await loadIceConfig(token));
        pcRef.current = pc;

        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        pc.ontrack = (event) => {
          const remoteStream = event.streams[0] || new MediaStream([event.track]);
          remoteStreamRef.current = remoteStream;
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStream;
            remoteVideoRef.current.muted = false;
            remoteVideoRef.current.volume = 1;
            remoteVideoRef.current.play().catch(() => {});
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
          console.log('[WebRTC] ICE state:', state);
          if ((state === 'failed' || state === 'disconnected') && iceRestartCount.current < 3) {
            iceRestartCount.current++;
            try { pc.restartIce(); } catch { /* ignore */ }
            if (isInitiator) {
              pc.createOffer({ iceRestart: true }).then(async (offer) => {
                await pc.setLocalDescription(offer);
                socket.emit('webrtc:offer', { to: targetUserId, offer });
              }).catch(() => {});
            }
          }
        };

        pc.onconnectionstatechange = () => {
          if (!mounted) return;
          console.log('[WebRTC] Connection state:', pc.connectionState);
          if (pc.connectionState === 'connected') {
            if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);
            setStatus('connected');
            iceRestartCount.current = 0;
            // Re-assert speaker after media starts (iOS often resets route).
            void setNativeSpeaker(true);
            setAudioRoute('speaker');
            if (!timerRef.current) {
              timerRef.current = window.setInterval(() => setDuration((d) => d + 1), 1000);
            }
          } else if (pc.connectionState === 'failed') {
            if (iceRestartCount.current >= 3) doEnd();
          } else if (pc.connectionState === 'disconnected') {
            setTimeout(() => {
              const current = pcRef.current;
              if (!current || current.connectionState !== 'disconnected') return;
              if (iceRestartCount.current < 3) {
                iceRestartCount.current++;
                try { current.restartIce(); } catch { /* ignore */ }
                return;
              }
              doEnd();
            }, 12000);
          }
        };

        socket.on('call:accepted', onAccepted);
        socket.on('call:rejected', onRejected);
        socket.on('webrtc:offer', onOffer);
        socket.on('webrtc:answer', onAnswer);
        socket.on('webrtc:ice-candidate', onIce);
        socket.on('call:ended', onEnded);
        socket.on('call:unavailable', onUnavailable);
        socket.emit('webrtc:ready', { peerId: targetUserId });

        if (pendingOffer.current) {
          const offer = pendingOffer.current;
          pendingOffer.current = null;
          await applyOffer(offer);
        }
        if (pendingAnswer.current) {
          const answer = pendingAnswer.current;
          pendingAnswer.current = null;
          await applyAnswer(answer);
        }

        if (isInitiator) {
          socket.emit('call:initiate', {
            to: targetUserId,
            conversationId,
            callerName: user?.displayName || '',
          });
          callTimeoutRef.current = window.setTimeout(() => {
            if (!mounted) return;
            setStatus('unavailable');
            setTimeout(() => doEnd(), 2000);
          }, 30000);
        } else {
          socket.emit('call:accept', { to: targetUserId });
        }
      } catch (err) {
        console.error('[WebRTC] Call setup failed:', err);
        if (!mounted) return;
        setStatus('error');
        setTimeout(() => doEnd(), 3000);
      }
    };

    setupCall();

    return () => {
      mounted = false;
      if (!ended) {
        removeListeners();
        doClean();
        setIncomingCall(null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMute = () => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setIsMuted(!track.enabled);
    }
  };

  const toggleAudioRoute = async () => {
    const next: AudioRoute = audioRoute === 'speaker' ? 'earpiece' : 'speaker';
    setAudioRoute(next);
    await setNativeSpeaker(next === 'speaker');
  };

  const formatDur = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const statusText: Record<string, string> = {
    calling: 'Вызов...',
    connecting: 'Подключение...',
    connected: formatDur(duration),
    rejected: 'Вызов отклонён',
    unavailable: 'Абонент недоступен',
    error: 'Ошибка соединения',
    insecure: 'Для звонка нужен HTTPS',
  };

  return (
    <div className="video-call-overlay">
      <div className="video-call">
        <video
          ref={remoteVideoRef}
          className="remote-video"
          autoPlay
          playsInline
        />

        <div className="call-top-bar">
          <span className="call-name">{targetName}</span>
          <span className="call-status">{statusText[status]}</span>
        </div>

        <video
          ref={localVideoRef}
          className="local-video"
          autoPlay
          playsInline
          muted
          style={{ transform: 'scaleX(-1)' }}
        />

        <div className="call-controls">
          <button
            className={`call-control-btn ${isMuted ? 'active' : ''}`}
            onClick={toggleMute}
            title={isMuted ? 'Включить микрофон' : 'Выключить микрофон'}
          >
            {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
          </button>
          <button
            className={`call-control-btn ${audioRoute === 'speaker' ? 'active' : ''}`}
            onClick={() => { void toggleAudioRoute(); }}
            title={audioRoute === 'speaker' ? 'Динамик' : 'Телефонный динамик'}
          >
            {audioRoute === 'speaker' ? <Volume2 size={24} /> : <Ear size={24} />}
          </button>
          <button className="call-control-btn end-call" onClick={endCall} title="Сбросить">
            <PhoneOff size={24} />
          </button>
        </div>
      </div>
    </div>
  );
}
