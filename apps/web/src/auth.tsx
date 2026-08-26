import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AuthUser, fetchProfile, login as loginApi } from './services/auth';
import { clearToken, getToken, setToken, setWorkingTenantId } from './services/request';

type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  hasPermission: (code: string) => boolean;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const bootstrap = useCallback(async () => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    try {
      const profile = await fetchProfile();
      setUser(profile);
      if (profile.tenantId) {
        setWorkingTenantId(profile.tenantId);
      }
    } catch {
      clearToken();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const login = useCallback(async (username: string, password: string) => {
    const result = await loginApi(username, password);
    setToken(result.accessToken);
    setUser(result.user);
    setWorkingTenantId(result.user.tenantId);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setWorkingTenantId(null);
    setUser(null);
  }, []);

  const hasPermission = useCallback(
    (code: string) => {
      if (!user) return false;
      if (user.roles.includes('SUPER_ADMIN')) return true;
      return user.permissions.includes(code);
    },
    [user],
  );

  const value = useMemo(
    () => ({ user, loading, login, logout, hasPermission }),
    [user, loading, login, logout, hasPermission],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
