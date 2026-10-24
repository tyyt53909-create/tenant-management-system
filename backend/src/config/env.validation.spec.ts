import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { checkEnvironment, validateEnvironment } from './env.validation.js';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function productionEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/tenant_system',
    JWT_SECRET: 'a'.repeat(32),
    ENCRYPTION_KEY: 'c'.repeat(32),
    CORS_ORIGINS: 'https://admin.example.com',
    REDIS_HOST: 'redis',
    ...overrides,
  };
}

describe('validateEnvironment', () => {
  it('生产模式缺少 DATABASE_URL 和 JWT_SECRET 时抛错并写明变量名', () => {
    expect(() => validateEnvironment({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
    expect(() => validateEnvironment({ NODE_ENV: 'production' })).toThrow(/JWT_SECRET/);
  });

  it('生产模式拒绝示例 JWT_SECRET', () => {
    expect(() =>
      validateEnvironment(
        productionEnv({ JWT_SECRET: 'your-jwt-secret-change-this-in-production' }),
      ),
    ).toThrow(/JWT_SECRET/);
  });

  it('生产模式拒绝短于 32 字节的 JWT_SECRET（T258）', () => {
    expect(() => validateEnvironment(productionEnv({ JWT_SECRET: 'short-secret' }))).toThrow(
      /JWT_SECRET.*32/,
    );
    expect(() => validateEnvironment(productionEnv({ JWT_SECRET: 'a'.repeat(31) }))).toThrow(
      /JWT_SECRET/,
    );
  });

  it('开发模式短 JWT_SECRET 只警告，不阻止启动', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const config = { NODE_ENV: 'development', DATABASE_URL: 'postgres://local', JWT_SECRET: 'short' };

    expect(validateEnvironment(config)).toBe(config);
    expect(warn.mock.calls.map((call) => call.join(' ')).join('\n')).toMatch(/JWT_SECRET.*32/);
    warn.mockRestore();
  });

  it('生产模式缺少 ENCRYPTION_KEY 时抛错（证件号加解密依赖它，不能等到运行时才炸）', () => {
    expect(() => validateEnvironment(productionEnv({ ENCRYPTION_KEY: '' }))).toThrow(/ENCRYPTION_KEY/);
    expect(() => validateEnvironment(productionEnv({ ENCRYPTION_KEY: undefined }))).toThrow(/ENCRYPTION_KEY/);
  });

  it('生产模式三项必填齐备时通过', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const config = productionEnv();

    expect(validateEnvironment(config)).toBe(config);
    warn.mockRestore();
  });

  it('非生产模式缺少 ENCRYPTION_KEY 只警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const config = { NODE_ENV: 'development', DATABASE_URL: 'postgres://local', JWT_SECRET: 'b'.repeat(32) };

    expect(validateEnvironment(config)).toBe(config);
    expect(warn.mock.calls.map((call) => call.join(' ')).join('\n')).toMatch(/ENCRYPTION_KEY/);
    warn.mockRestore();
  });

  it('开发模式缺少可选项只警告，不阻止通过', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const config = { NODE_ENV: 'development', DATABASE_URL: 'postgres://local', JWT_SECRET: 'b'.repeat(32) };

    expect(validateEnvironment(config)).toBe(config);
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.map((call) => call.join(' ')).join('\n')).toMatch(/SMTP_HOST/);
    warn.mockRestore();
  });

  it('生产模式缺少必填项时，进程以非 0 退出，且日志包含变量名', () => {
    const result = spawnSync(
      process.execPath,
      [
        // 用 tsx 作为加载器而不是 --experimental-strip-types：后者是 Node 22.6+ 才有的选项，
        // CI 跑 Node 20 会报 "bad option: --experimental-strip-types"（T212 在 CI 上暴露）
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `import { validateEnvironment } from './src/config/env.validation.ts';
         try {
           validateEnvironment({ NODE_ENV: 'production', JWT_SECRET: '' });
           process.exit(0);
         } catch (error) {
           console.error(error instanceof Error ? error.message : String(error));
           process.exit(1);
         }`,
      ],
      { cwd: backendRoot, encoding: 'utf8' },
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stderr}\n${result.stdout}`).toContain('DATABASE_URL');
    expect(`${result.stderr}\n${result.stdout}`).toContain('JWT_SECRET');
  });

  it('生产模式一次列出全部缺漏，而不是只报第一个', () => {
    const { errors } = checkEnvironment({ NODE_ENV: 'production' });
    for (const key of ['DATABASE_URL', 'JWT_SECRET', 'ENCRYPTION_KEY', 'CORS_ORIGINS']) {
      expect(errors.some((error) => error.includes(key))).toBe(true);
    }
    expect(errors.some((error) => error.includes('REDIS_URL 或 REDIS_HOST'))).toBe(true);
  });

  it('生产/预发禁止 ADMIN_PASSWORD、万能验证码与模拟开关', () => {
    const { errors } = checkEnvironment(
      productionEnv({
        ADMIN_PASSWORD: 'secret-password',
        OTP_DEV_BYPASS: 'true',
        GOOGLE_AUTH_MOCK: 'true',
        FEATURE_METER_SIMULATOR: 'true',
      }),
    );
    expect(errors.some((error) => error.includes('ADMIN_PASSWORD'))).toBe(true);
    expect(errors.some((error) => error.includes('OTP_DEV_BYPASS'))).toBe(true);
    expect(errors.some((error) => error.includes('GOOGLE_AUTH_MOCK'))).toBe(true);
    expect(errors.some((error) => error.includes('FEATURE_METER_SIMULATOR'))).toBe(true);
  });

  it('CORS 不允许通配符，REDIS_URL 必须是 redis/rediss', () => {
    const cors = checkEnvironment(productionEnv({ CORS_ORIGINS: '*' }));
    expect(cors.errors.some((error) => error.includes('CORS_ORIGINS'))).toBe(true);

    const redis = checkEnvironment(productionEnv({ REDIS_URL: 'http://redis:6379' }));
    expect(redis.errors.some((error) => error.includes('REDIS_URL'))).toBe(true);
  });

  it('错误信息不包含任何机密值', () => {
    const { errors, warnings } = checkEnvironment(
      productionEnv({ DATABASE_URL: 'not-a-url', JWT_SECRET: 'short', ENCRYPTION_KEY: 'x' }),
    );
    const text = [...errors, ...warnings].join('\n');
    expect(text).not.toContain('not-a-url');
    expect(text).not.toContain('short');
  });
});
