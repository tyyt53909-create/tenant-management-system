import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { validateEnvironment } from './env.validation.js';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function productionEnv(overrides: Record<string, string> = {}) {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/tenant_system',
    JWT_SECRET: 'a'.repeat(32),
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
        '--experimental-strip-types',
        '--disable-warning=ExperimentalWarning',
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
});
