import type { CookieOptions, Request, Response } from 'express';

export const REFRESH_TOKEN_COOKIE_NAME = 'refresh_token';

const REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const REFRESH_TOKEN_COOKIE_PATH = '/api/auth';

/**
 * `secure` 由调用方传入（控制器从 ConfigService 取 NODE_ENV），此处不读 process.env——
 * 模块级常量会在 import 时求值，早于 ConfigModule 把 `.env` 载入 process.env，容易悄悄失效。
 */
export function refreshTokenCookieOptions(secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: REFRESH_TOKEN_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_MAX_AGE_MS,
  };
}

export function setRefreshTokenCookie(res: Response, token: string, secure: boolean): void {
  if (typeof res?.cookie === 'function') {
    res.cookie(REFRESH_TOKEN_COOKIE_NAME, token, refreshTokenCookieOptions(secure));
  }
}

export function clearRefreshTokenCookie(res: Response, secure: boolean): void {
  if (typeof res?.clearCookie === 'function') {
    res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path: REFRESH_TOKEN_COOKIE_PATH,
    });
  }
}

export function extractRefreshToken(req?: Request, dtoToken?: string): string | undefined {
  if (dtoToken && typeof dtoToken === 'string' && dtoToken.trim()) {
    return dtoToken.trim();
  }
  const cookies = (req as { cookies?: Record<string, string> } | undefined)?.cookies;
  if (cookies && typeof cookies[REFRESH_TOKEN_COOKIE_NAME] === 'string') {
    const fromCookie = cookies[REFRESH_TOKEN_COOKIE_NAME]?.trim();
    if (fromCookie) return fromCookie;
  }
  return undefined;
}
