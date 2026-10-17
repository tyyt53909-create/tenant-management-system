import { describe, expect, it } from 'vitest';
import { loadBootstrapConfig, resolvePort } from './bootstrap.config.js';

describe('loadBootstrapConfig', () => {
  it('解析端口、日志级别、CORS 与代理设置', () => {
    const config = loadBootstrapConfig({
      NODE_ENV: 'production',
      PORT: '3100',
      LOG_LEVEL: 'warn',
      CORS_ORIGINS: 'https://admin.example.com',
      TRUST_PROXY: '1',
    });

    expect(config.nodeEnv).toBe('production');
    expect(config.isProduction).toBe(true);
    expect(config.port).toBe(3100);
    expect(config.logLevel).toBe('warn');
    expect(config.corsOrigins).toEqual(['https://admin.example.com']);
    expect(config.trustProxy).toBe(1);
  });

  it('缺省时给出开发默认值，且不信任代理', () => {
    const config = loadBootstrapConfig({});

    expect(config.nodeEnv).toBe('development');
    expect(config.isProduction).toBe(false);
    expect(config.port).toBe(3000);
    expect(config.logLevel).toBe('info');
    expect(config.trustProxy).toBe(false);
  });

  it('生产环境默认信任一层反向代理', () => {
    expect(loadBootstrapConfig({ NODE_ENV: 'production' }).trustProxy).toBe(1);
  });
});

describe('resolvePort', () => {
  it('非法值回退到 3000，而不是让 listen 抛错', () => {
    expect(resolvePort('abc')).toBe(3000);
    expect(resolvePort('0')).toBe(3000);
    expect(resolvePort('70000')).toBe(3000);
    expect(resolvePort(undefined)).toBe(3000);
  });

  it('接受合法端口（含字符串两侧空白）', () => {
    expect(resolvePort(' 8080 ')).toBe(8080);
  });
});
