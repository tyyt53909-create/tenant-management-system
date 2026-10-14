import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserConfig } from 'vite';
import config from './vite.config';

afterEach(() => vi.unstubAllEnvs());

async function developmentConfig(): Promise<UserConfig> {
  return typeof config === 'function' ? config({ command: 'serve', mode: 'test' }) : config;
}

describe('本地 API 代理', () => {
  it('默认连接租客后端 3100 而不是其他服务的 3000', async () => {
    vi.stubEnv('VITE_API_PROXY_TARGET', '');
    const resolved = await developmentConfig();
    expect(resolved.server?.proxy?.['/api']).toMatchObject({ target: 'http://127.0.0.1:3100' });
    expect(resolved.server?.strictPort).toBe(true);
    expect(resolved.server?.host).toBe('127.0.0.1');
  });

  it('允许通过环境变量指定后端', async () => {
    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://127.0.0.1:3200');
    const resolved = await developmentConfig();
    expect(resolved.server?.proxy?.['/api']).toMatchObject({ target: 'http://127.0.0.1:3200' });
  });
});
