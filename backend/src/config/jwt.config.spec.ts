import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import jwtConfig, {
  DEFAULT_ACCESS_TOKEN_EXPIRY,
  DEFAULT_REFRESH_TOKEN_EXPIRY,
} from './jwt.config.js';

describe('jwt.config（T258）', () => {
  const original = {
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_ACCESS_EXPIRY: process.env.JWT_ACCESS_EXPIRY,
    JWT_REFRESH_EXPIRY: process.env.JWT_REFRESH_EXPIRY,
  };

  beforeEach(() => {
    process.env.JWT_SECRET = 'a'.repeat(32);
    delete process.env.JWT_ACCESS_EXPIRY;
    delete process.env.JWT_REFRESH_EXPIRY;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('缺少 JWT_SECRET 时启动即抛错', () => {
    delete process.env.JWT_SECRET;
    expect(() => jwtConfig()).toThrow(/JWT_SECRET/);
  });

  it('未配置过期时间时使用 15m / 7d 默认值', () => {
    const config = jwtConfig();
    expect(config.accessTokenExpiry).toBe(DEFAULT_ACCESS_TOKEN_EXPIRY);
    expect(config.refreshTokenExpiry).toBe(DEFAULT_REFRESH_TOKEN_EXPIRY);
  });

  it('非法过期格式（纯数字/未知单位）启动即抛错，避免退化成毫秒', () => {
    process.env.JWT_ACCESS_EXPIRY = '900';
    expect(() => jwtConfig()).toThrow(/JWT_ACCESS_EXPIRY/);

    delete process.env.JWT_ACCESS_EXPIRY;
    process.env.JWT_REFRESH_EXPIRY = '7x';
    expect(() => jwtConfig()).toThrow(/JWT_REFRESH_EXPIRY/);
  });

  it('合法时长原样保留', () => {
    process.env.JWT_ACCESS_EXPIRY = '30m';
    process.env.JWT_REFRESH_EXPIRY = '14d';
    const config = jwtConfig();
    expect(config.accessTokenExpiry).toBe('30m');
    expect(config.refreshTokenExpiry).toBe('14d');
  });
});
