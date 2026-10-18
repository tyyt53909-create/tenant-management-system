import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { User } from '@/types';
import { login as loginApi, loginWithGoogle as loginWithGoogleApi, getCurrentUser, logout as logoutApi } from '@/api/auth';
import { setAccessToken, getAccessToken, refreshAccessToken } from '@/utils/request';

export const useUserStore = defineStore('user', () => {
  const user = ref<User | null>(null);
  const token = ref<string | null>(getAccessToken());

  const updateToken = (newToken: string | null) => {
    token.value = newToken;
    setAccessToken(newToken);
  };

  // 密码登录
  const login = async (identifier: string, password: string) => {
    const response: any = await loginApi({ identifier, password });
    updateToken(response.accessToken);
    await fetchUserInfo();
  };

  // Google 登录
  const loginWithGoogleToken = async (idToken: string, inviteCode?: string) => {
    const response: any = await loginWithGoogleApi({ idToken, inviteCode });
    updateToken(response.accessToken);
    await fetchUserInfo();
    return response;
  };

  // 获取用户信息
  const fetchUserInfo = async () => {
    try {
      user.value = await getCurrentUser();
    } catch (error) {
      console.error('Failed to fetch user info:', error);
    }
  };

  /**
   * 应用启动或刷新页面时恢复登录态。
   * access token 仅存内存，刷新页面时通过 HttpOnly Cookie 静默请求 /api/auth/refresh 恢复。
   */
  const restoreSession = async (): Promise<boolean> => {
    try {
      const newAccessToken = await refreshAccessToken();
      updateToken(newAccessToken);
      await fetchUserInfo();
      return true;
    } catch {
      updateToken(null);
      user.value = null;
      return false;
    }
  };

  const init = async () => {
    if (token.value) {
      await fetchUserInfo();
    } else {
      await restoreSession();
    }
  };

  // 登出：清空内存态，调用服务端撤销会话与 HttpOnly Cookie
  const logout = () => {
    user.value = null;
    updateToken(null);
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    void logoutApi().catch(() => undefined);
  };

  return {
    user,
    token,
    login,
    loginWithGoogleToken,
    logout,
    fetchUserInfo,
    restoreSession,
    init,
  };
});
