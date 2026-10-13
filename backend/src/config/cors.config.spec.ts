import { resolveCorsOrigins, DEFAULT_ORIGINS } from './cors.config.js';

/**
 * T161：CORS 白名单解析
 *
 * 背景：CORS 原先硬编码两个 origin，小程序 H5 跑在 5174 时被拦，
 * 表现为「页面能开但登录失败、控制台报 blocked by CORS」。
 */
describe('resolveCorsOrigins', () => {
  it('未配置 → 回落本地开发默认值', () => {
    expect(resolveCorsOrigins(undefined)).toEqual(DEFAULT_ORIGINS);
  });

  it('空串 → 仍回落默认值（不能静默拒绝所有跨域）', () => {
    expect(resolveCorsOrigins('')).toEqual(DEFAULT_ORIGINS);
  });

  it('纯空白/多余逗号 → 回落默认值', () => {
    expect(resolveCorsOrigins('  ,  , ')).toEqual(DEFAULT_ORIGINS);
  });

  it('解析逗号分隔并去除空白', () => {
    expect(resolveCorsOrigins(' http://a.com , http://b.com ')).toEqual([
      'http://a.com',
      'http://b.com',
    ]);
  });

  it('默认值同时包含 localhost 与 127.0.0.1（不同 origin，都必须列）', () => {
    expect(DEFAULT_ORIGINS).toContain('http://localhost:5173');
    expect(DEFAULT_ORIGINS).toContain('http://127.0.0.1:5173');
    expect(DEFAULT_ORIGINS).toContain('http://127.0.0.1:5174');
  });

  it('返回新数组，调用方修改不会污染默认值', () => {
    const a = resolveCorsOrigins(undefined);
    a.push('http://evil.com');
    expect(resolveCorsOrigins(undefined)).not.toContain('http://evil.com');
  });
});
