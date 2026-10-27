import { describe, it, expect, vi } from 'vitest';
import {
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  extractRefreshToken,
  refreshTokenCookieOptions,
  stripRefreshTokenForBrowser,
  REFRESH_TOKEN_COOKIE_NAME,
} from './auth-cookie.util.js';

describe('auth-cookie.util', () => {
  it('setRefreshTokenCookie 应使用安全属性设置 Cookie', () => {
    const res = { cookie: vi.fn() } as any;
    setRefreshTokenCookie(res, 'test-refresh-token', true);

    const options = refreshTokenCookieOptions(true);
    expect(res.cookie).toHaveBeenCalledWith(REFRESH_TOKEN_COOKIE_NAME, 'test-refresh-token', options);
    expect(options.httpOnly).toBe(true);
    expect(options.path).toBe('/api/auth');
    expect(options.sameSite).toBe('strict');
  });

  it('secure 标志完全由调用方决定（不再读模块加载时的 NODE_ENV）', () => {
    expect(refreshTokenCookieOptions(true).secure).toBe(true);
    expect(refreshTokenCookieOptions(false).secure).toBe(false);
  });

  it('maxAge 与 JWT_REFRESH_EXPIRY 对齐（T258）', () => {
    expect(refreshTokenCookieOptions(true, 3600_000).maxAge).toBe(3600_000);
    const res = { cookie: vi.fn() } as any;
    setRefreshTokenCookie(res, 'token', true, 3600_000);
    expect(res.cookie).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE_NAME,
      'token',
      expect.objectContaining({ maxAge: 3600_000 }),
    );
  });

  it('clearRefreshTokenCookie 应清除 HttpOnly Cookie', () => {
    const res = { clearCookie: vi.fn() } as any;
    clearRefreshTokenCookie(res, true);

    expect(res.clearCookie).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE_NAME,
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        path: '/api/auth',
        sameSite: 'strict',
      }),
    );
  });

  it('extractRefreshToken 优先提取 DTO 中的 refreshToken', () => {
    const req = {
      cookies: { [REFRESH_TOKEN_COOKIE_NAME]: 'cookie-token' },
    } as any;
    const token = extractRefreshToken(req, 'dto-token');
    expect(token).toBe('dto-token');
  });

  it('extractRefreshToken 在 DTO 为空时从 Cookie 中提取', () => {
    const req = {
      cookies: { [REFRESH_TOKEN_COOKIE_NAME]: 'cookie-token' },
    } as any;
    const token = extractRefreshToken(req, undefined);
    expect(token).toBe('cookie-token');
  });

  it('extractRefreshToken 均无时返回 undefined', () => {
    const req = { cookies: {} } as any;
    expect(extractRefreshToken(req, undefined)).toBeUndefined();
    expect(extractRefreshToken(undefined, undefined)).toBeUndefined();
  });

  describe('stripRefreshTokenForBrowser', () => {
    it('浏览器 POST 请求（带 Origin）应当剥除 refreshToken', () => {
      const data = { accessToken: 'acc', refreshToken: 'ref', user: { id: 'u1' } };
      const req = { method: 'POST', headers: { origin: 'http://localhost:5173' } } as any;
      const stripped = stripRefreshTokenForBrowser(data, req);
      expect(stripped.refreshToken).toBeUndefined();
      expect(stripped.accessToken).toBe('acc');
    });

    it('非浏览器 POST 请求（无 Origin）保留 refreshToken 供小程序使用', () => {
      const data = { accessToken: 'acc', refreshToken: 'ref' };
      const req = { method: 'POST', headers: {} } as any;
      const stripped = stripRefreshTokenForBrowser(data, req);
      expect(stripped.refreshToken).toBe('ref');
    });

    it('无 refreshToken 的对象保持原样', () => {
      const data = { accessToken: 'acc' };
      const req = { method: 'POST', headers: { origin: 'http://localhost:5173' } } as any;
      expect(stripRefreshTokenForBrowser(data, req)).toEqual(data);
    });
  });
});
