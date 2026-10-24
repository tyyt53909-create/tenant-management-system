import { describe, expect, it } from 'vitest';
import { randomDigits, randomHex, randomOtpCode } from './secure-random.js';

describe('randomDigits', () => {
  it('返回指定长度的纯数字串', () => {
    for (const length of [1, 6, 12]) {
      const value = randomDigits(length);
      expect(value).toHaveLength(length);
      expect(value).toMatch(/^\d+$/);
    }
  });

  it('允许首位为 0', () => {
    const values = Array.from({ length: 200 }, () => randomDigits(6));
    expect(values.some((value) => value.startsWith('0'))).toBe(true);
  });

  it('长度非法时抛 RangeError', () => {
    expect(() => randomDigits(0)).toThrow(RangeError);
    expect(() => randomDigits(-1)).toThrow(RangeError);
    expect(() => randomDigits(1.5)).toThrow(RangeError);
  });
});

describe('randomOtpCode', () => {
  it('始终是 100000–999999 的 6 位数字', () => {
    for (let index = 0; index < 500; index += 1) {
      const code = randomOtpCode();
      expect(code).toMatch(/^\d{6}$/);
      const parsed = Number(code);
      expect(parsed).toBeGreaterThanOrEqual(100_000);
      expect(parsed).toBeLessThan(1_000_000);
    }
  });

  it('不使用 Math.random', () => {
    const source = randomOtpCode.toString();
    expect(source).toContain('randomInt');
    expect(source).not.toContain('Math.random');
  });
});

describe('randomInt 边界', () => {
  it('randomOtpCode 在多次采样中不重复', () => {
    const codes = new Set(Array.from({ length: 200 }, () => randomOtpCode()));
    expect(codes.size).toBeGreaterThan(190);
  });
});

describe('randomHex', () => {
  it('返回指定字节数两倍长度的大写十六进制串', () => {
    const value = randomHex(4);
    expect(value).toHaveLength(8);
    expect(value).toMatch(/^[0-9A-F]+$/);
  });

  it('非法长度抛 RangeError', () => {
    expect(() => randomHex(0)).toThrow(RangeError);
    expect(() => randomHex(-1)).toThrow(RangeError);
    expect(() => randomHex(1.5)).toThrow(RangeError);
  });

  it('多次采样不重复', () => {
    const values = new Set(Array.from({ length: 200 }, () => randomHex(4)));
    expect(values.size).toBe(200);
  });
});
