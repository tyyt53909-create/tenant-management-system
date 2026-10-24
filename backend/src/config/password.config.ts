/** 密码哈希与登录防护的可调参数。默认值面向生产，测试可通过环境变量收紧或放宽。 */
export const BCRYPT_ROUNDS_DEFAULT = 12;
export const BCRYPT_ROUNDS_MIN = 10;
export const BCRYPT_ROUNDS_MAX = 14;

export const LOGIN_MAX_FAILED_ATTEMPTS_DEFAULT = 5;
export const LOGIN_LOCK_MS_DEFAULT = 15 * 60 * 1000;

export interface LoginProtection {
  maxFailedAttempts: number;
  lockMs: number;
  bcryptRounds: number;
}

export interface LoginProtectionEnv {
  LOGIN_MAX_FAILED_ATTEMPTS?: string;
  LOGIN_LOCK_MS?: string;
  BCRYPT_ROUNDS?: string;
}

export function resolveLoginProtection(env: LoginProtectionEnv = process.env): LoginProtection {
  return {
    maxFailedAttempts: readInteger(
      env.LOGIN_MAX_FAILED_ATTEMPTS,
      LOGIN_MAX_FAILED_ATTEMPTS_DEFAULT,
      1,
      100,
    ),
    lockMs: readInteger(env.LOGIN_LOCK_MS, LOGIN_LOCK_MS_DEFAULT, 1_000, 24 * 60 * 60 * 1000),
    bcryptRounds: resolveBcryptRounds(env.BCRYPT_ROUNDS),
  };
}

/** bcrypt cost 只接受 10–14；非法值回落到默认 12，避免误配成 4 轮把密码变脆。 */
export function resolveBcryptRounds(raw: string | undefined): number {
  return readInteger(raw, BCRYPT_ROUNDS_DEFAULT, BCRYPT_ROUNDS_MIN, BCRYPT_ROUNDS_MAX);
}

function readInteger(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}
