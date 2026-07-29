import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import type { User } from '../types';

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, displayName: string, password: string) => Promise<void>;
  requestPhoneCode: (phone: string) => Promise<{ retryAfterSec?: number; expiresInSec?: number; debugCode?: string }>;
  verifyPhoneCode: (phone: string, code: string, displayName?: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>(null!);

export function useAuth() {
  return useContext(AuthContext);
}

function getStoredToken(): string | null {
  return localStorage.getItem('token') || null;
}

function getStoredUser(): User | null {
  try {
    const raw = localStorage.getItem('maktime_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function isNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

async function readNativeAuth(): Promise<{ token: string | null; user: User | null }> {
  if (!isNativePlatform()) return { token: null, user: null };
  try {
    const [tokenResult, userResult] = await Promise.all([
      Preferences.get({ key: 'maktime_native_token' }),
      Preferences.get({ key: 'maktime_native_user' }),
    ]);
    const token = tokenResult.value || null;
    const user = userResult.value ? (JSON.parse(userResult.value) as User) : null;
    return { token, user };
  } catch {
    return { token: null, user: null };
  }
}

async function writeNativeAuth(token: string, user: User): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    await Promise.all([
      Preferences.set({ key: 'maktime_native_token', value: token }),
      Preferences.set({ key: 'maktime_native_user', value: JSON.stringify(user) }),
    ]);
  } catch {}
}

async function clearNativeAuth(): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    await Promise.all([
      Preferences.remove({ key: 'maktime_native_token' }),
      Preferences.remove({ key: 'maktime_native_user' }),
    ]);
  } catch {}
}

function clearLocalAuth() {
  localStorage.removeItem('token');
  localStorage.removeItem('maktime_user');
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(getStoredToken);
  const [user, setUser] = useState<User | null>(getStoredUser);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      let t = getStoredToken();
      let u = getStoredUser();

      if (!t) {
        const nativeAuth = await readNativeAuth();
        if (nativeAuth.token) {
          t = nativeAuth.token;
          u = nativeAuth.user;
          localStorage.setItem('token', t);
          if (u) localStorage.setItem('maktime_user', JSON.stringify(u));
        }
      }

      if (!t) {
        if (!cancelled) setLoading(false);
        return;
      }

      if (!cancelled) {
        setToken(t);
        if (u) setUser(u);
      }

      try {
        const response = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${t}` } });
        if (response.status === 401) {
          clearLocalAuth();
          await clearNativeAuth();
          if (!cancelled) {
            setToken(null);
            setUser(null);
          }
          return;
        }
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) setUser(data);
        localStorage.setItem('maktime_user', JSON.stringify(data));
        await writeNativeAuth(t, data);
      } catch {}
      finally {
        if (!cancelled) setLoading(false);
      }
    };

    void bootstrap();

    return () => { cancelled = true; };
  }, []);

  const persistAuth = useCallback((tkn: string, usr: User) => {
    localStorage.setItem('token', tkn);
    localStorage.setItem('maktime_user', JSON.stringify(usr));
    setToken(tkn);
    setUser(usr);
    void writeNativeAuth(tkn, usr);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const normalizedUsername = username.trim();
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: normalizedUsername, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    persistAuth(data.token, data.user);
  }, [persistAuth]);

  const register = useCallback(async (username: string, displayName: string, password: string) => {
    const normalizedUsername = username.trim();
    const normalizedDisplayName = displayName.trim();
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: normalizedUsername, displayName: normalizedDisplayName, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    persistAuth(data.token, data.user);
  }, [persistAuth]);

  const requestPhoneCode = useCallback(async (phone: string) => {
    const res = await fetch('/api/auth/phone/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: phone.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || 'Не удалось отправить SMS-код');
    return {
      retryAfterSec: typeof data?.retryAfterSec === 'number' ? data.retryAfterSec : undefined,
      expiresInSec: typeof data?.expiresInSec === 'number' ? data.expiresInSec : undefined,
      debugCode: typeof data?.debugCode === 'string' ? data.debugCode : undefined,
    };
  }, []);

  const verifyPhoneCode = useCallback(async (phone: string, code: string, displayName?: string) => {
    const res = await fetch('/api/auth/phone/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: phone.trim(),
        code: code.trim(),
        displayName: displayName?.trim() || '',
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || 'Не удалось подтвердить код');
    persistAuth(data.token, data.user);
  }, [persistAuth]);

  const logout = useCallback(() => {
    clearLocalAuth();
    void clearNativeAuth();
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, requestPhoneCode, verifyPhoneCode, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
