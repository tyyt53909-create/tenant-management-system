import axios, { AxiosError, AxiosHeaders } from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';
import { ElMessage } from 'element-plus';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request, { setAccessToken, getAccessToken } from './request';

vi.mock('element-plus', () => ({ ElMessage: { error: vi.fn() } }));

function unauthorized(config: InternalAxiosRequestConfig) {
  return new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, undefined, {
    status: 401, statusText: 'Unauthorized', data: { message: 'Unauthorized' },
    headers: new AxiosHeaders(), config,
  });
}

describe('请求认证恢复', () => {
  beforeEach(() => {
    const values = new Map<string, string>([
      ['theme', 'qiju'],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    });
    vi.stubGlobal('window', { location: { href: '/rooms', pathname: '/rooms' } });
    setAccessToken('expired');
  });

  afterEach(() => {
    setAccessToken(null);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('登录失败不刷新旧会话，也不重试密码', async () => {
    const refresh = vi.spyOn(axios, 'post').mockResolvedValue({ data: { accessToken: 'new' } });
    let calls = 0;
    request.defaults.adapter = async (config) => {
      if (++calls === 1) throw unauthorized(config);
      return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
    };
    await expect(request.post('/auth/login', { identifier: 'wrong', password: 'wrong' })).rejects.toThrow();
    expect(refresh).not.toHaveBeenCalled();
    expect(calls).toBe(1);
  });

  it('刷新后仍为 401 只重试一次，保留非认证设置', async () => {
    const refresh = vi.spyOn(axios, 'post').mockResolvedValue({ data: { accessToken: 'new' } });
    let calls = 0;
    request.defaults.adapter = async (config) => {
      if (++calls <= 2) throw unauthorized(config);
      return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
    };
    await expect(request.get('/rooms')).rejects.toThrow();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(calls).toBe(2);
    expect(getAccessToken()).toBeNull();
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
    expect(localStorage.getItem('theme')).toBe('qiju');
    expect(window.location.href).toBe('/login');
  });

  it('多个并发 401 共用一次刷新，并携带新 token 重试', async () => {
    const refresh = vi.spyOn(axios, 'post').mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { data: { accessToken: 'new' } };
    });
    request.defaults.adapter = async (config) => {
      if (config.headers.Authorization !== 'Bearer new') throw unauthorized(config);
      return { data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config };
    };
    await expect(Promise.all([request.get('/rooms'), request.get('/tenants')]))
      .resolves.toEqual([{ ok: true }, { ok: true }]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBe('new');
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
  });

  it('刷新成功时更新内存 token，localStorage 中无任何 token', async () => {
    vi.spyOn(axios, 'post').mockResolvedValue({
      data: { accessToken: 'new-access', refreshToken: 'rotated-refresh' },
    });
    request.defaults.adapter = async (config) => {
      if (config.headers.Authorization !== 'Bearer new-access') throw unauthorized(config);
      return { data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config };
    };
    await expect(request.get('/rooms')).resolves.toEqual({ ok: true });
    expect(getAccessToken()).toBe('new-access');
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
  });

  it('刷新失败时退出会话，不清除主题设置', async () => {
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('refresh expired'));
    request.defaults.adapter = async (config) => { throw unauthorized(config); };
    await expect(request.get('/rooms')).rejects.toThrow('refresh expired');
    expect(getAccessToken()).toBeNull();
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
    expect(localStorage.getItem('theme')).toBe('qiju');
    expect(window.location.href).toBe('/login');
  });

  it('按错误码提示能力暂停和内部错误，不展示 SQL', async () => {
    localStorage.removeItem('refresh_token');
    request.defaults.adapter = async (config) => {
      throw new AxiosError('err', 'ERR_BAD_REQUEST', config, undefined, {
        status: 403,
        statusText: 'Forbidden',
        data: { code: 'CAPABILITY_DENIED', message: 'CAPABILITY_DENIED', requestId: 'req-cap' },
        headers: new AxiosHeaders(),
        config,
      });
    };
    await expect(request.get('/bills')).rejects.toBeTruthy();
    expect(ElMessage.error).toHaveBeenCalledWith('当前账号的这项功能已暂停');

    request.defaults.adapter = async (config) => {
      throw new AxiosError('err', 'ERR_BAD_REQUEST', config, undefined, {
        status: 500,
        statusText: 'Error',
        data: { code: 'COMMON_INTERNAL_ERROR', message: 'SELECT password FROM users', requestId: 'req-500' },
        headers: new AxiosHeaders(),
        config,
      });
    };
    await expect(request.get('/rooms')).rejects.toBeTruthy();
    expect(ElMessage.error).toHaveBeenCalledWith('服务器内部错误，请稍后重试');
  });
});
