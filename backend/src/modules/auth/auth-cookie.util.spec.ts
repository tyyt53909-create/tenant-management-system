import { describe, it, expect, vi } from 'vitest';
import {
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  extractRefreshToken,
  REFRESH_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_OPTIONS,
} from './auth-cookie.util.js';

describe('auth-cookie.util', () => {
  it('setRefreshTokenCookie 应使用安全属性设置 Cookie', () => {
    const res = { cookie: vi.fn() } as any;
    setRefreshTokenCookie(res, 'test-refresh-token');

    expect(res.cookie).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE_NAME,
      'test-refresh-token',
      REFRESH_TOKEN_COOKIE_OPTIONS,
    );
    expect(REFRESH_TOKEN_COOKIE_OPTIONS.httpOnly).toBe(true);
    expect(REFRESH_TOKEN_COOKIE_OPTIONS.path).toBe('/api/auth');
    expect(REFRESH_TOKEN_COOKIE_OPTIONS.sameSite).toBe('strict');
  });

  it('clearRefreshTokenCookie 应清除 HttpOnly Cookie', () => {
    const res = { clearCookie: vi.fn() } as any;
    clearRefreshTokenCookie(res);

    expect(res.clearCookie).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE_NAME,
      expect.objectContaining({
        httpOnly: true,
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
});
