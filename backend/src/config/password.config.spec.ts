import { describe, expect, it } from 'vitest';
import {
  BCRYPT_ROUNDS_DEFAULT,
  LOGIN_LOCK_MS_DEFAULT,
  LOGIN_MAX_FAILED_ATTEMPTS_DEFAULT,
  resolveBcryptRounds,
  resolveLoginProtection,
} from './password.config.js';

describe('resolveBcryptRounds', () => {
  it('默认 12', () => {
    expect(resolveBcryptRounds(undefined)).toBe(BCRYPT_ROUNDS_DEFAULT);
    expect(resolveBcryptRounds('')).toBe(BCRYPT_ROUNDS_DEFAULT);
  });

  it('接受 10–14', () => {
    expect(resolveBcryptRounds('10')).toBe(10);
    expect(resolveBcryptRounds('14')).toBe(14);
  });

  it('越界或非法值回落到默认值', () => {
    expect(resolveBcryptRounds('4')).toBe(BCRYPT_ROUNDS_DEFAULT);
    expect(resolveBcryptRounds('15')).toBe(BCRYPT_ROUNDS_DEFAULT);
    expect(resolveBcryptRounds('abc')).toBe(BCRYPT_ROUNDS_DEFAULT);
    expect(resolveBcryptRounds('12.5')).toBe(BCRYPT_ROUNDS_DEFAULT);
  });
});

describe('resolveLoginProtection', () => {
  it('未配置时使用生产默认值', () => {
    expect(resolveLoginProtection({})).toEqual({
      maxFailedAttempts: LOGIN_MAX_FAILED_ATTEMPTS_DEFAULT,
      lockMs: LOGIN_LOCK_MS_DEFAULT,
      bcryptRounds: BCRYPT_ROUNDS_DEFAULT,
    });
  });

  it('读取合法覆盖值', () => {
    expect(
      resolveLoginProtection({
        LOGIN_MAX_FAILED_ATTEMPTS: '3',
        LOGIN_LOCK_MS: '60000',
        BCRYPT_ROUNDS: '10',
      }),
    ).toEqual({ maxFailedAttempts: 3, lockMs: 60_000, bcryptRounds: 10 });
  });

  it('非法值回落', () => {
    expect(
      resolveLoginProtection({
        LOGIN_MAX_FAILED_ATTEMPTS: '0',
        LOGIN_LOCK_MS: '999',
        BCRYPT_ROUNDS: '99',
      }),
    ).toEqual({
      maxFailedAttempts: LOGIN_MAX_FAILED_ATTEMPTS_DEFAULT,
      lockMs: LOGIN_LOCK_MS_DEFAULT,
      bcryptRounds: BCRYPT_ROUNDS_DEFAULT,
    });
  });
});
