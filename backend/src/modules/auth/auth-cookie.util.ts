import type { CookieOptions, Request, Response } from 'express';

export const REFRESH_TOKEN_COOKIE_NAME = 'refresh_token';

export const REFRESH_TOKEN_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/api/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

export function setRefreshTokenCookie(res: Response, token: string): void {
  if (typeof res?.cookie === 'function') {
    res.cookie(REFRESH_TOKEN_COOKIE_NAME, token, REFRESH_TOKEN_COOKIE_OPTIONS);
  }
}

export function clearRefreshTokenCookie(res: Response): void {
  if (typeof res?.clearCookie === 'function') {
    res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/auth',
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
