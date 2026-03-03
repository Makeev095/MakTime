import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { User } from '../types';

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, displayName: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>(null!);

export function useAuth() {
  return useContext(AuthContext);
}

const TOKEN_KEY = 'maktime_token';
const USER_KEY = 'maktime_user';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const cached = localStorage.getItem(USER_KEY);
      return cached ? JSON.parse(cached) : null;
    } catch { return null; }
  });
  const [token, setToken] = useState<string | null>(localStorage.getItem(TOKEN_KEY));
  const [loading, setLoading] = useState(true);
  const didVerify = useRef(false);

  useEffect(() => {
    if (didVerify.current) return;
    didVerify.current = true;

    if (!token) {
      setLoading(false);
      return;
    }
    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((data) => {
        setUser(data);
        localStorage.setItem(USER_KEY, JSON.stringify(data));
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        setToken(null);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, [token]);

  const persistAuth = useCallback((tkn: string, usr: User) => {
    localStorage.setItem(TOKEN_KEY, tkn);
    localStorage.setItem(USER_KEY, JSON.stringify(usr));
    setToken(tkn);
    setUser(usr);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    persistAuth(data.token, data.user);
  }, [persistAuth]);

  const register = useCallback(async (username: string, displayName: string, password: string) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, displayName, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    persistAuth(data.token, data.user);
  }, [persistAuth]);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
