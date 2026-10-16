import type { ThrottlerGetTrackerFunction, ThrottlerModuleOptions } from '@nestjs/throttler';

/** 生产与开发的默认限流。测试环境未显式设置时会把次数抬高，避免既有测试和 e2e 被误伤。 */
export const THROTTLE_DEFAULTS = {
  global: { limit: 100, ttl: 60_000 },
  auth: { limit: 10, ttl: 60_000 },
  otp: { limit: 5, ttl: 60 * 60 * 1000 },
} as const;

const TEST_LIMIT = 100_000;

export interface ThrottleLimits {
  global: { limit: number; ttl: number };
  auth: { limit: number; ttl: number };
  otp: { limit: number; ttl: number };
}

export function resolveThrottleLimits(env: NodeJS.ProcessEnv = process.env): ThrottleLimits {
  const relaxed = env.NODE_ENV === 'test' ? TEST_LIMIT : undefined;
  return {
    global: {
      limit: readLimit(env.THROTTLE_GLOBAL_LIMIT, relaxed ?? THROTTLE_DEFAULTS.global.limit),
      ttl: THROTTLE_DEFAULTS.global.ttl,
    },
    auth: {
      limit: readLimit(env.THROTTLE_AUTH_LIMIT, relaxed ?? THROTTLE_DEFAULTS.auth.limit),
      ttl: THROTTLE_DEFAULTS.auth.ttl,
    },
    otp: {
      limit: readLimit(env.THROTTLE_OTP_LIMIT, relaxed ?? THROTTLE_DEFAULTS.otp.limit),
      ttl: THROTTLE_DEFAULTS.otp.ttl,
    },
  };
}

export function createThrottleModuleOptions(): ThrottlerModuleOptions {
  return {
    throttlers: [
      {
        name: 'default',
        ttl: () => resolveThrottleLimits().global.ttl,
        limit: () => resolveThrottleLimits().global.limit,
      },
    ],
  };
}

/**
 * 生产环境默认信任一层反向代理。本地直连默认关闭，避免客户端伪造 X-Forwarded-For 绕过按 IP 限流。
 * TRUST_PROXY 可设为 false/0、true，或正整数（信任的代理跳数）。
 */
export function resolveTrustProxy(raw: string | undefined, nodeEnv: string | undefined): boolean | number {
  if (raw === undefined || raw.trim() === '') {
    return nodeEnv === 'production' ? 1 : false;
  }
  const value = raw.trim().toLowerCase();
  if (value === 'false' || value === '0') {
    return false;
  }
  if (value === 'true') {
    return true;
  }
  const hops = Number(value);
  if (Number.isInteger(hops) && hops > 0) {
    return hops;
  }
  return false;
}

/** 发送验证码按邮箱计数。没有合法邮箱时退回 IP，避免空 body 共用一个桶。 */
export const otpEmailTracker: ThrottlerGetTrackerFunction = (req) => {
  const body = req.body as { email?: unknown } | undefined;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email.includes('@')) {
    return `email:${email}`;
  }
  const ip = typeof req.ip === 'string' && req.ip.length > 0 ? req.ip : 'unknown';
  return `ip:${ip}`;
};

function readLimit(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}
