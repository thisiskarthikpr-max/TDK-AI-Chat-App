import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const AuthContext = createContext(null);
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

async function readJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? 'Something went wrong. Please try again.');
  return body;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const tokenRef = useRef(null);
  const refreshPromiseRef = useRef(null);

  const saveSession = useCallback((session) => {
    tokenRef.current = session.accessToken;
    setAccessToken(session.accessToken);
    setUser(session.user);
  }, []);

  const clearSession = useCallback(() => {
    tokenRef.current = null;
    setAccessToken(null);
    setUser(null);
  }, []);

  const refreshSession = useCallback(() => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;

    const sendRefresh = async () => {
      let response = await fetch(`${API_URL}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });

      // Fallback for browsers without Web Locks: a parallel tab may have just rotated the shared cookie.
      for (const delayMs of [120, 300]) {
        if (response.status !== 409) break;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        response = await fetch(`${API_URL}/api/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        });
      }
      return response;
    };

    const runRefresh = async () => {
      try {
        const response = typeof navigator !== 'undefined' && navigator.locks?.request
          ? await navigator.locks.request('tdk-ai-chat-refresh', sendRefresh)
          : await sendRefresh();
        if (!response.ok) {
          clearSession();
          return null;
        }
        const session = await readJson(response);
        saveSession(session);
        return session.accessToken;
      } catch {
        clearSession();
        return null;
      }
    };

    const sharedPromise = runRefresh();
    refreshPromiseRef.current = sharedPromise;
    void sharedPromise.finally(() => {
      if (refreshPromiseRef.current === sharedPromise) refreshPromiseRef.current = null;
    });
    return sharedPromise;
  }, [clearSession, saveSession]);

  useEffect(() => {
    refreshSession().finally(() => setLoading(false));
  }, [refreshSession]);

  const authenticate = useCallback(async (action, credentials) => {
    const response = await fetch(`${API_URL}/api/auth/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(credentials),
    });
    const session = await readJson(response);
    saveSession(session);
    return session.user;
  }, [saveSession]);

  const login = useCallback((credentials) => authenticate('login', credentials), [authenticate]);
  const signup = useCallback((credentials) => authenticate('signup', credentials), [authenticate]);

  const logout = useCallback(async () => {
    try {
      await fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' });
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const authFetch = useCallback(async (path, options = {}) => {
    const send = (token) => {
      const headers = new Headers(options.headers ?? {});
      if (token) headers.set('authorization', `Bearer ${token}`);
      return fetch(`${API_URL}${path}`, { ...options, headers, credentials: 'include' });
    };

    let response = await send(tokenRef.current);
    if (response.status === 401 && !options.skipRefresh) {
      const freshToken = await refreshSession();
      if (freshToken) response = await send(freshToken);
    }
    return response;
  }, [refreshSession]);

  return (
    <AuthContext.Provider value={{ user, accessToken, loading, login, signup, logout, authFetch }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
