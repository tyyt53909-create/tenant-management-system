import { describe, it, expect } from 'vitest';
import { formatMoney, formatDateOnly, formatDateTime, centsToYuan } from './table';

/**
 * T160：表格格式化工具
 *
 * 说明：本模块刻意不提供排序工具。Element Plus 的 sort-method 入参形态
 * 随 sort-by 配置变化，容易写出恒返回 0 的比较器（表现为「点表头没反应」）。
 * 项目统一使用内置 `sortable sort-by="<字段>"`：金额是整数（分）、
 * 日期是完整 ISO 串，二者内置排序均正确。相关结论见 utils/table.ts 顶部注释。
 */
describe('格式化', () => {
  it('formatMoney：分 → 带千分位与两位小数', () => {
    expect(formatMoney(100000)).toBe('¥1,000.00');
    expect(formatMoney(30050)).toBe('¥300.50');
    expect(formatMoney(0)).toBe('¥0.00');
    expect(formatMoney(123456789)).toBe('¥1,234,567.89');
  });

  it('formatMoney 对空值不产生 NaN', () => {
    expect(formatMoney(undefined)).toBe('¥0.00');
    expect(formatMoney(null)).toBe('¥0.00');
  });

  it('centsToYuan：分 → 元', () => {
    expect(centsToYuan(30050)).toBe(300.5);
    expect(centsToYuan(0)).toBe(0);
  });

  it('formatDateOnly：取日期部分，空值给「—」', () => {
    expect(formatDateOnly('2026-10-23T00:00:00.000Z')).toBe('2026-10-23');
    expect(formatDateOnly(null)).toBe('—');
    expect(formatDateOnly(undefined)).toBe('—');
  });

  it('formatDateTime：截断到分钟', () => {
    expect(formatDateTime('2026-10-23T14:30:59.000Z')).toBe('2026-10-23 14:30');
    expect(formatDateTime(null)).toBe('—');
  });
});
