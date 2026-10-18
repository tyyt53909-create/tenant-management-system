import type { ThrottlerGetTrackerFunction, ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';

/** 生产与开发的默认限流。测试环境未显式设置时会把次数抬高，避免既有测试和 e2e 被误伤。 */
export const THROTTLE_DEFAULTS = {
  global: { limit: 100, ttl: 60_000 },
  auth: { limit: 10, ttl: 60_000 },
  otp: { limit: 5, ttl: 60 * 60 * 1000 },
  /** 发送验证码的每 IP 上限：按邮箱计数之外还要有一层，否则换一个邮箱就是一个新桶（可被寄信轰炸）。 */
  otpIp: { limit: 30, ttl: 60 * 60 * 1000 },
} as const;

/**
 * 按邮箱计数的命名限流器。
 *
 * @nestjs/throttler 每条路由对每个命名限流器只会用一个 tracker（guard 里是
 * `routeOrClassGetTracker || namedThrottler.getTracker || commonOptions.getTracker`），
 * 所以在路由上给 `default` 挂 getTracker 会**顶掉**按 IP 的全局限流。
 * 故把邮箱计数放进独立的命名限流器：tracker 由模块配置提供，路由只收紧它的次数，
 * `default` 的 IP tracker 保持不变。
 */
export const OTP_EMAIL_THROTTLER_NAME = 'otpEmail';

/** 命名限流器的全局上限：足够宽松，使其只在实际使用它的路由上生效。 */
const OTP_EMAIL_GLOBAL_LIMIT = 100_000;

const TEST_LIMIT = 100_000;

export interface ThrottleLimits {
  global: { limit: number; ttl: number };
  auth: { limit: number; ttl: number };
  otp: { limit: number; ttl: number };
  otpIp: { limit: number; ttl: number };
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
    otpIp: {
      limit: readLimit(env.THROTTLE_OTP_IP_LIMIT, relaxed ?? THROTTLE_DEFAULTS.otpIp.limit),
      ttl: THROTTLE_DEFAULTS.otpIp.ttl,
    },
  };
}

export function createThrottleModuleOptions(storage?: ThrottlerStorage): ThrottlerModuleOptions {
  return {
    storage,
    throttlers: [
      {
        name: 'default',
        ttl: () => resolveThrottleLimits().global.ttl,
        limit: () => resolveThrottleLimits().global.limit,
      },
      {
        name: OTP_EMAIL_THROTTLER_NAME,
        ttl: () => resolveThrottleLimits().otp.ttl,
        limit: () => OTP_EMAIL_GLOBAL_LIMIT,
        getTracker: otpEmailTracker,
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
