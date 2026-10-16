import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { User } from '@/types';
import { login as loginApi, loginWithGoogle as loginWithGoogleApi, getCurrentUser, logout as logoutApi } from '@/api/auth';

export const useUserStore = defineStore('user', () => {
  const user = ref<User | null>(null);
  const token = ref<string | null>(localStorage.getItem('access_token'));

  // 密码登录
  const login = async (identifier: string, password: string) => {
    const response: any = await loginApi({ identifier, password });
    token.value = response.accessToken;
    localStorage.setItem('access_token', response.accessToken);
    localStorage.setItem('refresh_token', response.refreshToken);
    await fetchUserInfo();
  };

  // Google 登录
  const loginWithGoogleToken = async (idToken: string, inviteCode?: string) => {
    const response: any = await loginWithGoogleApi({ idToken, inviteCode });
    token.value = response.accessToken;
    localStorage.setItem('access_token', response.accessToken);
    localStorage.setItem('refresh_token', response.refreshToken);
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
   * 应用启动时恢复登录态（T157）。
   * 原先仅 login() 会拉取用户信息，导致刷新页面后 store 为空、
   * 头部显示兜底文案「管理员」而不是真实邮箱。
   */
  const init = async () => {
    if (!token.value) return;
    await fetchUserInfo();
  };

  // 登出：先清本地会话，再通知服务端作废这枚 refresh token。网络失败也不把人留在已退出的页面。
  const logout = () => {
    const refreshToken = localStorage.getItem('refresh_token');
    user.value = null;
    token.value = null;
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    if (refreshToken) {
      void logoutApi(refreshToken).catch(() => undefined);
    }
  };

  return {
    user,
    token,
    login,
    loginWithGoogleToken,
    logout,
    fetchUserInfo,
    init,
  };
});
