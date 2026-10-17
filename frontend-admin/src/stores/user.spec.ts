import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useUserStore } from './user';
import { getAccessToken, setAccessToken } from '@/utils/request';
import * as authApi from '@/api/auth';
import * as requestUtils from '@/utils/request';

describe('useUserStore - Token in Memory & Cookie Refresh', () => {
  let storageMap: Map<string, string>;

  beforeEach(() => {
    storageMap = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storageMap.get(key) ?? null,
      setItem: (key: string, value: string) => storageMap.set(key, value),
      removeItem: (key: string) => storageMap.delete(key),
      clear: () => storageMap.clear(),
    });
    setActivePinia(createPinia());
    setAccessToken(null);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('login 时将 access token 存入内存，localStorage 中无任何 token', async () => {
    vi.spyOn(authApi, 'login').mockResolvedValue({
      accessToken: 'test-access-token',
      refreshToken: 'cookie-handled-token',
    } as any);
    vi.spyOn(authApi, 'getCurrentUser').mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.com',
      role: 'ADMIN',
    } as any);

    const store = useUserStore();
    await store.login('admin@example.com', 'password123');

    expect(store.token).toBe('test-access-token');
    expect(getAccessToken()).toBe('test-access-token');
    expect(store.user?.email).toBe('admin@example.com');

    // 关键断言：localStorage 中没有 access_token 或 refresh_token
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
  });

  it('restoreSession 通过 HttpOnly Cookie 静默刷新恢复登录态', async () => {
    vi.spyOn(requestUtils, 'refreshAccessToken').mockResolvedValue('restored-access-token');
    vi.spyOn(authApi, 'getCurrentUser').mockResolvedValue({
      id: 'admin-2',
      email: 'restored@example.com',
      role: 'ADMIN',
    } as any);

    const store = useUserStore();
    const success = await store.restoreSession();

    expect(success).toBe(true);
    expect(store.token).toBe('restored-access-token');
    expect(getAccessToken()).toBe('restored-access-token');
    expect(store.user?.email).toBe('restored@example.com');
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
  });

  it('restoreSession 刷新失败时重置状态并返回 false', async () => {
    vi.spyOn(requestUtils, 'refreshAccessToken').mockRejectedValue(new Error('Cookie expired'));

    const store = useUserStore();
    const success = await store.restoreSession();

    expect(success).toBe(false);
    expect(store.token).toBeNull();
    expect(getAccessToken()).toBeNull();
    expect(store.user).toBeNull();
  });

  it('logout 清空内存 token 并通知服务端撤销 Cookie', async () => {
    const logoutSpy = vi.spyOn(authApi, 'logout').mockResolvedValue({} as any);
    setAccessToken('active-token');

    const store = useUserStore();
    store.token = 'active-token';
    store.user = { id: 'admin-1', email: 'admin@example.com', role: 'ADMIN' } as any;

    store.logout();

    expect(store.token).toBeNull();
    expect(getAccessToken()).toBeNull();
    expect(store.user).toBeNull();
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
    expect(logoutSpy).toHaveBeenCalled();
  });
});
