import { describe, expect, it } from 'vitest';
import {
  centsToYuan,
  centsToYuanString,
  formatCents,
  formatSignedCents,
  sumCents,
  yuanToCents,
} from './money.util.js';

describe('金额工具（T275）', () => {
  it('元 ↔ 分 与字符串格式化', () => {
    expect(yuanToCents(12.345)).toBe(1235);
    expect(centsToYuan(123456)).toBe(1234.56);
    expect(centsToYuanString(10050)).toBe('100.50');
    expect(formatCents(123456)).toBe('¥1,234.56');
    expect(formatCents(-123456)).toBe('-¥1,234.56');
    expect(formatSignedCents(100)).toBe('+¥1.00');
    expect(formatSignedCents(-100)).toBe('-¥1.00');
    expect(formatSignedCents(0)).toBe('¥0.00');
  });

  it('非数字输入退化为 0，不产生 NaN', () => {
    expect(yuanToCents('abc')).toBe(0);
    expect(centsToYuan(undefined)).toBe(0);
    expect(sumCents([100, null, undefined, 'x' as never, 50])).toBe(150);
  });
});
