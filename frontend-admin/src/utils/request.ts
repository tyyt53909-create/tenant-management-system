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
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

type RetryConfig = InternalAxiosRequestConfig & { _authRetried?: boolean };
let inMemoryAccessToken: string | null = null;
let refreshPromise: Promise<string> | null = null;

export function setAccessToken(token: string | null): void {
  inMemoryAccessToken = token;
}

export function getAccessToken(): string | null {
  return inMemoryAccessToken;
}

function expireSession() {
  setAccessToken(null);
  // 清理任何遗留旧 token，保留主题等与认证无关的本地设置。
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

/**
 * 后端判定「该 refresh token 正被另一个并发请求轮换」时返回的错误。
 *
 * 多标签页（或前后端同源的多个窗口）会同时带着同一份旧 cookie 发刷新请求：
 * 只有一个能赢，输的那个在宽限窗口内会拿到这条消息（T208）。此时服务端**没有**
 * 撤销会话家族，赢家也已经把新的 refresh cookie 写回浏览器 —— 只是本标签页这次
 * 请求发出的还是旧 cookie。短暂等待后用新 cookie 重试一次即可成功。
 */
function isRotationRace(error: unknown): boolean {
  const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  return typeof message === 'string' && message.includes('正在轮换中');
}

const ROTATION_RETRY_DELAY_MS = 300;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postRefresh(): Promise<string> {
  const response = await axios.post(
    `${API_BASE_URL}/auth/refresh`,
    {},
    { withCredentials: true, timeout: 15000 },
  );
  const token = response.data?.accessToken;
  if (typeof token !== 'string' || !token) throw new Error('刷新响应缺少 accessToken');
  return token;
}

export function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      let token: string;
      try {
        token = await postRefresh();
      } catch (error) {
        // 只对「并发轮换」这一种失败重试；其它错误（cookie 过期、被撤销）照旧抛出去
        if (!isRotationRace(error)) throw error;
        await delay(ROTATION_RETRY_DELAY_MS);
        token = await postRefresh();
      }
      setAccessToken(token);
      return token;
    })().finally(() => {
      refreshPromise = null;
    });
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
    const token = getAccessToken();
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
        // 登录/注册/刷新失败是凭据错误，不可刷新旧会话后重放密码请求。
        const authRequest = /\/auth\/(login|register|refresh)\/?$/.test(config?.url?.split('?')[0] || '');
        if (authRequest) return Promise.reject(error);

        if (config && !config._authRetried) {
          config._authRetried = true;
          try {
            const newToken = await refreshAccessToken();
            config.headers.Authorization = `Bearer ${newToken}`;
            return request(config);
          } catch (refreshError) {
            expireSession();
            return Promise.reject(refreshError);
          }
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
