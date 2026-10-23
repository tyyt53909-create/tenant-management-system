import { describe, expect, it } from 'vitest';
import { durationMsOr, parseDurationMs } from './duration.js';

describe('parseDurationMs（T258）', () => {
  it('解析秒/分/时/天/周', () => {
    expect(parseDurationMs('30s')).toBe(30_000);
    expect(parseDurationMs('15m')).toBe(15 * 60_000);
    expect(parseDurationMs('12h')).toBe(12 * 3_600_000);
    expect(parseDurationMs('7d')).toBe(7 * 86_400_000);
    expect(parseDurationMs('2w')).toBe(2 * 604_800_000);
  });

  it('容忍首尾空白', () => {
    expect(parseDurationMs(' 15m ')).toBe(15 * 60_000);
  });

  it('拒绝纯数字（jsonwebtoken 会按毫秒解释，容易把 15m 写成 900 毫秒）', () => {
    expect(parseDurationMs('900')).toBeUndefined();
  });

  it('拒绝非法格式与零值', () => {
    expect(parseDurationMs('')).toBeUndefined();
    expect(parseDurationMs('15')).toBeUndefined();
    expect(parseDurationMs('15x')).toBeUndefined();
    expect(parseDurationMs('m15')).toBeUndefined();
    expect(parseDurationMs('0d')).toBeUndefined();
    expect(parseDurationMs('-5m')).toBeUndefined();
    expect(parseDurationMs(undefined)).toBeUndefined();
    expect(parseDurationMs(null)).toBeUndefined();
  });

  it('durationMsOr 在非法输入时回退默认值', () => {
    expect(durationMsOr('7d', 1)).toBe(7 * 86_400_000);
    expect(durationMsOr('bad', 42)).toBe(42);
    expect(durationMsOr(undefined, 42)).toBe(42);
  });
});
