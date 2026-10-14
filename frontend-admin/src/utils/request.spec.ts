import axios, { AxiosError, AxiosHeaders } from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from './request';

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
      ['access_token', 'expired'], ['refresh_token', 'valid-refresh'], ['theme', 'qiju'],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    });
    vi.stubGlobal('window', { location: { href: '/rooms', pathname: '/rooms' } });
  });

  afterEach(() => {
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
  });

  it('刷新失败时退出会话，不清除主题设置', async () => {
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('refresh expired'));
    request.defaults.adapter = async (config) => { throw unauthorized(config); };
    await expect(request.get('/rooms')).rejects.toThrow('refresh expired');
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('theme')).toBe('qiju');
    expect(window.location.href).toBe('/login');
  });

  it('没有刷新 token 时不重复请求', async () => {
    localStorage.removeItem('refresh_token');
    const refresh = vi.spyOn(axios, 'post');
    request.defaults.adapter = async (config) => { throw unauthorized(config); };
    await expect(request.get('/rooms')).rejects.toThrow('Unauthorized');
    expect(refresh).not.toHaveBeenCalled();
    expect(localStorage.getItem('access_token')).toBeNull();
  });
});
