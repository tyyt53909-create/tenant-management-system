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

/**
 * 浏览器请求带 Origin，脚本能读到 JSON。刷新令牌只留在 HttpOnly Cookie。
 * 小程序等非浏览器客户端通常不带 Origin，仍需要响应体里的 refreshToken。
 *
 * 「带 Origin 即浏览器」只在浏览器必带 Origin 的方法（POST/PUT/PATCH/DELETE）上成立；
 * 同源 GET/HEAD 浏览器不带 Origin，区分不了客户端，一律剥除（fail-closed）。
 */
export function stripRefreshTokenForBrowser<T extends { refreshToken?: string }>(result: T, req?: Request): T {
  if (!result?.refreshToken) {
    return result;
  }
  const method = req?.method?.toUpperCase();
  const origin = req?.headers?.origin;
  const hasBrowserOrigin = typeof origin === 'string' && origin.trim() !== '';
  if (hasBrowserOrigin || method === 'GET' || method === 'HEAD') {
    const copy = { ...result };
    delete copy.refreshToken;
    return copy;
  }
  return result;
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
