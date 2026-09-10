/**
 * 后台登录态 Context：token 持久化到 `localStorage['cardline.token']`。
 *
 * - 首次挂载时用 `GET /api/auth/profile` 校验已有 token。
 * - 任意接口返回 401 时 api/client 会广播，这里自动清理登录态并跳转登录页。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  clearToken,
  getProfile,
  getToken,
  login as loginRequest,
  onUnauthorized,
  setToken,
} from '../api/client';
import type { AuthUser, LoginRequest } from '../api/types';

export interface AuthContextValue {
  /** 当前 token（null 表示未登录） */
  token: string | null;
  /** 当前管理员信息 */
  user: AuthUser | null;
  /** 是否已完成首次 token 校验 */
  ready: boolean;
  login: (payload: LoginRequest) => Promise<AuthUser>;
  logout: () => void;
  reloadProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState<boolean>(() => getToken() === null);

  /** 已经校验过的 token，避免登录后立刻重复拉取 profile */
  const verifiedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!token) {
      verifiedTokenRef.current = null;
      setUser(null);
      setReady(true);
      return;
    }

    if (verifiedTokenRef.current === token) {
      setReady(true);
      return;
    }

    let cancelled = false;
    setReady(false);

    getProfile()
      .then((profile) => {
        if (cancelled) return;
        verifiedTokenRef.current = token;
        setUser(profile);
      })
      .catch(() => {
        if (cancelled) return;
        verifiedTokenRef.current = null;
        clearToken();
        setTokenState(null);
        setUser(null);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(
    () =>
      onUnauthorized(() => {
        verifiedTokenRef.current = null;
        setTokenState(null);
        setUser(null);
        setReady(true);
      }),
    [],
  );

  const login = useCallback(async (payload: LoginRequest) => {
    const response = await loginRequest(payload);
    setToken(response.token);
    verifiedTokenRef.current = response.token;
    setTokenState(response.token);
    setUser(response.user);
    setReady(true);
    return response.user;
  }, []);

  const logout = useCallback(() => {
    clearToken();
    verifiedTokenRef.current = null;
    setTokenState(null);
    setUser(null);
    setReady(true);
  }, []);

  const reloadProfile = useCallback(async () => {
    const profile = await getProfile();
    setUser(profile);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ token, user, ready, login, logout, reloadProfile }),
    [token, user, ready, login, logout, reloadProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth 必须在 <AuthProvider> 内部使用');
  }
  return context;
}
