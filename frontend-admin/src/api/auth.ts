import axios from 'axios';
import request from '@/utils/request';
import type { LoginForm, RegisterForm, User } from '@/types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

// 登录
export const login = (data: LoginForm) => {
  return request.post('/auth/login', data);
};

// 注册
export const register = (data: RegisterForm) => {
  return request.post('/auth/register', data);
};

// 刷新 Token
export const refreshToken = (refreshToken: string) => {
  return request.post('/auth/refresh', { refreshToken });
};

// 不走带拦截器的客户端，避免登出时再用这枚 refresh token 去刷新。
export const logout = (refreshToken: string) => {
  return axios.post(`${API_BASE_URL}/auth/logout`, { refreshToken }, { timeout: 15000 });
};

// 获取当前用户信息
export const getCurrentUser = (): Promise<User> => {
  return request.get('/auth/me');
};

// 获取 Google Client ID
export const getGoogleClientId = (): Promise<{ clientId: string }> => {
  return request.get('/auth/google/client-id');
};

// Google 登录
export const loginWithGoogle = (data: { idToken: string; inviteCode?: string }) => {
  return request.post('/auth/google', data);
};

// 生成邀请码（支持单码与批量）
export const generateInviteCode = (data: {
  count?: number;
  expiryDays?: number;
  notes?: string;
  role?: 'ADMIN' | 'TENANT';
}) => {
  return request.post('/auth/invite-codes', data);
};

// 获取邀请码列表
export const getInviteCodes = (params?: {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
}) => {
  return request.get('/auth/invite-codes', { params });
};

// 作废邀请码
export const revokeInviteCode = (id: string) => {
  return request.delete(`/auth/invite-codes/${id}`);
};
