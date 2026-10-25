import { describe, expect, it } from 'vitest';
import {
  centsToYuan,
  centsToYuanString,
  formatCents,
  formatSignedCents,
  sumCents,
  yuanToCents,
} from './money.js';

describe('金额换算（T275 单一入口，共享版）', () => {
  it('分 ↔ 元 四舍五入到整数分', () => {
    expect(yuanToCents('12.345')).toBe(1235);
    expect(yuanToCents(0)).toBe(0);
    expect(yuanToCents('abc')).toBe(0);
    expect(centsToYuan(123456)).toBe(1234.56);
    expect(centsToYuan(null)).toBe(0);
  });

  it('formatCents 带货币符号与千分位，负数符号在货币符号前', () => {
    expect(formatCents(123456)).toBe('¥1,234.56');
    expect(formatCents(0)).toBe('¥0.00');
    expect(formatCents(-123456)).toBe('-¥1,234.56');
  });

  it('centsToYuanString 不带货币符号与千分位', () => {
    expect(centsToYuanString(123456)).toBe('1234.56');
    expect(centsToYuanString(-125)).toBe('-1.25');
  });

  it('formatSignedCents 用于收支流水', () => {
    expect(formatSignedCents(100)).toBe('+¥1.00');
    expect(formatSignedCents(-100)).toBe('-¥1.00');
    expect(formatSignedCents(0)).toBe('¥0.00');
  });

  it('sumCents 合计并忽略非数字', () => {
    expect(sumCents([100, 200, null, undefined])).toBe(300);
    expect(sumCents([])).toBe(0);
  });
});
