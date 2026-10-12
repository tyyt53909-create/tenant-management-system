import axios from 'axios';
import type { AxiosInstance, AxiosResponse } from 'axios';
import { ElMessage } from 'element-plus';

const request: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000',
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器
request.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器
request.interceptors.response.use(
  (response: AxiosResponse) => {
    return response.data;
  },
  async (error) => {
    if (error.response) {
      const { status, data } = error.response;

      // Token 过期，尝试刷新
      if (status === 401) {
        const refreshToken = localStorage.getItem('refresh_token');
        if (refreshToken) {
          try {
            const response: any = await axios.post(
              `${import.meta.env.VITE_API_BASE_URL}/auth/refresh`,
              { refreshToken }
            );
            localStorage.setItem('access_token', response.data.accessToken);
            // 重试原请求
            return request(error.config);
          } catch (refreshError) {
            // 刷新失败，跳转登录
            localStorage.clear();
            window.location.href = '/login';
            ElMessage.error('登录已过期，请重新登录');
            return Promise.reject(refreshError);
          }
        } else {
          localStorage.clear();
          window.location.href = '/login';
          ElMessage.error('请先登录');
        }
      } else {
        ElMessage.error(data?.message || '请求失败');
      }
    } else {
      ElMessage.error('网络错误，请检查网络连接');
    }

    return Promise.reject(error);
  }
);

export default request;
