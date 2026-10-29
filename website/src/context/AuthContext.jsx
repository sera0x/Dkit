import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api, restoreSession, setAccessToken, getAccessToken, AUTH_CHANGED_EVENT } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState({ user: null, token: null });
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    let cancelled = false;
    restoreSession()
      .then((restored) => {
        if (cancelled) return;
        if (restored?.token) setAuth({ user: restored.user, token: restored.token });
      })
      .finally(() => { if (!cancelled) setBooting(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const sync = () => {
      const token = getAccessToken();
      setAuth((prev) => (token ? { ...prev, token } : { user: null, token: null }));
    };
    window.addEventListener(AUTH_CHANGED_EVENT, sync);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, sync);
  }, []);

  const login = useCallback((user, token) => {
    setAccessToken(token, user);
    setAuth({ user, token });
  }, []);

  const logout = useCallback(() => {
    api.logout();
    setAccessToken(null, null);
    setAuth({ user: null, token: null });
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user: auth.user,
        token: auth.token,
        booting,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
