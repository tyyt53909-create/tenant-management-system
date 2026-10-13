import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { User } from '@/types';
import { login as loginApi, getCurrentUser } from '@/api/auth';

export const useUserStore = defineStore('user', () => {
  const user = ref<User | null>(null);
  const token = ref<string | null>(localStorage.getItem('access_token'));

  // 登录
  const login = async (identifier: string, password: string) => {
    const response: any = await loginApi({ identifier, password });
    token.value = response.accessToken;
    localStorage.setItem('access_token', response.accessToken);
    localStorage.setItem('refresh_token', response.refreshToken);
    await fetchUserInfo();
  };

  // 获取用户信息
  const fetchUserInfo = async () => {
    try {
      user.value = await getCurrentUser();
    } catch (error) {
      console.error('Failed to fetch user info:', error);
    }
  };

  // 登出
  const logout = () => {
    user.value = null;
    token.value = null;
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
  };

  return {
    user,
    token,
    login,
    logout,
    fetchUserInfo,
  };
});
