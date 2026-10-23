import type { CookieOptions, Request, Response } from 'express';

export const REFRESH_TOKEN_COOKIE_NAME = 'refresh_token';

export const DEFAULT_REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const REFRESH_TOKEN_COOKIE_PATH = '/api/auth';

/**
 * `secure` 与 `maxAgeMs` 由调用方传入（控制器从 ConfigService 取 NODE_ENV / JWT_REFRESH_EXPIRY），
 * 此处不读 process.env——模块级常量会在 import 时求值，早于 ConfigModule 把 `.env`
 * 载入 process.env，容易悄悄失效。
 *
 * `maxAgeMs` 必须与 Refresh Token 的 `exp` 一致，否则会出现「Cookie 还活着但 token 已过期」
 * 或反向的错位（T258）。
 */
export function refreshTokenCookieOptions(
  secure: boolean,
  maxAgeMs: number = DEFAULT_REFRESH_TOKEN_MAX_AGE_MS,
): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: REFRESH_TOKEN_COOKIE_PATH,
    maxAge: maxAgeMs,
  };
}

export function setRefreshTokenCookie(
  res: Response,
  token: string,
  secure: boolean,
  maxAgeMs?: number,
): void {
  if (typeof res?.cookie === 'function') {
    res.cookie(REFRESH_TOKEN_COOKIE_NAME, token, refreshTokenCookieOptions(secure, maxAgeMs));
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
