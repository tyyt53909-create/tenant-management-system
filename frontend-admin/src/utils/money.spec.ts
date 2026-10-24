import { describe, expect, it } from 'vitest';
import {
  centsToYuan,
  formatMoney,
  formatMoneyPlain,
  formatSignedMoney,
  yuanToCents,
} from './money';

describe('金额格式化（T275 单一入口）', () => {
  it('分 ↔ 元 四舍五入到整数分', () => {
    expect(yuanToCents('12.345')).toBe(1235);
    expect(yuanToCents(0)).toBe(0);
    expect(yuanToCents('abc')).toBe(0);
    expect(centsToYuan(123456)).toBe(1234.56);
    expect(centsToYuan(null)).toBe(0);
  });

  it('formatMoney 带货币符号与千分位，负数符号在货币符号前', () => {
    expect(formatMoney(123456)).toBe('¥1,234.56');
    expect(formatMoney(0)).toBe('¥0.00');
    expect(formatMoney(-123456)).toBe('-¥1,234.56');
  });

  it('formatMoneyPlain 不带走货币符号与千分位', () => {
    expect(formatMoneyPlain(123456)).toBe('1234.56');
    expect(formatMoneyPlain(-125)).toBe('-1.25');
  });

  it('formatSignedMoney 用于收支流水', () => {
    expect(formatSignedMoney(100)).toBe('+¥1.00');
    expect(formatSignedMoney(-100)).toBe('-¥1.00');
    expect(formatSignedMoney(0)).toBe('¥0.00');
  });
});
