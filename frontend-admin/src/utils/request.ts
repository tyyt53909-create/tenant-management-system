import axios from 'axios';
import type { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { ElMessage } from 'element-plus';

declare module 'axios' {
  interface AxiosRequestConfig { silentError?: boolean }
}

// 统一 API 前缀：本地开发走 Vite 代理（默认 /api → http://127.0.0.1:3100/api）
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

const request: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

type RetryConfig = InternalAxiosRequestConfig & { _authRetried?: boolean };
let refreshPromise: Promise<string> | null = null;

function expireSession() {
  // 不删除主题等与认证无关的本地设置。
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  if (window.location.pathname !== '/login') {
    window.location.href = '/login';
    ElMessage.error('登录已过期，请重新登录');
  }
}

function errorText(data: { code?: string; message?: unknown; details?: unknown } | undefined): string {
  if (data?.code === 'CAPABILITY_DENIED') return '当前账号的这项功能已暂停';
  if (data?.code === 'COMMON_RATE_LIMIT_EXCEEDED') return '请求过于频繁，请稍后再试';
  if (data?.code === 'COMMON_INTERNAL_ERROR') return '服务器内部错误，请稍后重试';
  if (data?.code === 'COMMON_VALIDATION_ERROR' && Array.isArray(data.details)) {
    return data.details.map(String).join('；');
  }
  if (Array.isArray(data?.message)) return data.message.join('；');
  if (typeof data?.message === 'string' && data.message) return data.message;
  return '请求失败';
}

function refreshAccessToken(refreshToken: string): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken }, { timeout: 15000 })
      .then((response) => {
        const token = response.data.accessToken;
        const nextRefresh = response.data.refreshToken;
        if (typeof token !== 'string' || !token) throw new Error('刷新响应缺少 accessToken');
        localStorage.setItem('access_token', token);
        if (typeof nextRefresh === 'string' && nextRefresh) {
          localStorage.setItem('refresh_token', nextRefresh);
        }
        return token;
      })
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

/**
 * 剔除查询参数中的空值（undefined / null / 空串）。
 *
 * 后端全局 ValidationPipe 开启了 forbidNonWhitelisted，且枚举字段不接受空串，
 * 因此前端把表单原样展开（如 ?status=&billType=）会导致整个列表接口 400。
 * 在请求层统一收敛，避免每个视图各自处理。
 */
function pruneEmptyParams(params: unknown): unknown {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return params;
  }
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (value === undefined || value === null || value === '') continue;
    cleaned[key] = value;
  }
  return cleaned;
}

// 请求拦截器
request.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    config.params = pruneEmptyParams(config.params);
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器
request.interceptors.response.use(
  (response: AxiosResponse) => {
    if(['post','patch','put','delete'].includes(response.config.method || '') && !/\/auth\//.test(response.config.url || '') && typeof window.dispatchEvent==='function')window.dispatchEvent(new Event('qiju:data-updated'));
    return response.data;
  },
  async (error) => {
    if (error.response) {
      const { status, data } = error.response;

      // Token 过期，尝试刷新
      if (status === 401) {
        const config = error.config as RetryConfig | undefined;
        // 登录/注册失败是凭据错误，不可刷新旧会话后重放密码请求。
        const authRequest = /\/auth\/(login|register|refresh)\/?$/.test(config?.url?.split('?')[0] || '');
        if (authRequest) return Promise.reject(error);

        const refreshToken = localStorage.getItem('refresh_token');
        if (refreshToken && config && !config._authRetried) {
          config._authRetried = true;
          try {
            await refreshAccessToken(refreshToken);
          } catch (refreshError) {
            expireSession();
            return Promise.reject(refreshError);
          }
          // 最多重试一次；并发请求共用同一次刷新。
          return request(config);
        }
        expireSession();
      } else {
        if (!error.config?.silentError) ElMessage.error(errorText(data));
      }
    } else {
      if (!error.config?.silentError) ElMessage.error('网络错误，请检查网络连接');
    }

    return Promise.reject(error);
  }
);

export default request;
