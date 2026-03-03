import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';
import type { IncomingCall } from '../types';

interface SocketContextType {
  socket: Socket | null;
  incomingCall: IncomingCall | null;
  setIncomingCall: (call: IncomingCall | null) => void;
  onConversationCreated: (cb: () => void) => (() => void);
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  incomingCall: null,
  setIncomingCall: () => {},
  onConversationCreated: () => () => {},
});

export function useSocket() {
  return useContext(SocketContext);
}

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const convCreatedCallbacks = useRef<Set<() => void>>(new Set());

  useEffect(() => {
    if (!token) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setSocket(null);
      }
      return;
    }

    const s = io(window.location.origin, {
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    s.on('call:incoming', (data: IncomingCall) => {
      setIncomingCall(data);
      playNotificationSound();
    });

    s.on('conversation:created', () => {
      convCreatedCallbacks.current.forEach((cb) => cb());
    });

    socketRef.current = s;
    setSocket(s);

    return () => {
      s.disconnect();
    };
  }, [token]);

  const onConversationCreated = useCallback((cb: () => void) => {
    convCreatedCallbacks.current.add(cb);
    return () => { convCreatedCallbacks.current.delete(cb); };
  }, []);

  return (
    <SocketContext.Provider value={{ socket, incomingCall, setIncomingCall, onConversationCreated }}>
      {children}
    </SocketContext.Provider>
  );
}

function playNotificationSound() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.setValueAtTime(600, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
  } catch {}
}

export { playNotificationSound };
