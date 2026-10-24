import { describe, expect, it } from 'vitest';
import {
  METRIC_CALIBERS,
  bucketMonthlyRevenue,
  collectionRate,
  occupancyRate,
  percent,
  remainingAmount,
  sumAmounts,
} from './finance-metrics.js';

describe('财务指标口径（T275）', () => {
  it('sumAmounts 忽略非数字并按分取整', () => {
    const rows = [{ amount: 100 }, { amount: 50.6 }, { amount: null }, { amount: 'bad' as never }];
    expect(sumAmounts(rows, (row) => row.amount as number)).toBe(151);
  });

  it('collectionRate：分母为 0 返回 null，否则保留 1 位小数', () => {
    expect(collectionRate(0, 0)).toBeNull();
    expect(collectionRate(3000, 2000)).toBe(66.7);
    expect(collectionRate(3, 3)).toBe(100);
  });

  it('remainingAmount 不允许负数', () => {
    expect(remainingAmount(1000, 400)).toBe(600);
    expect(remainingAmount(1000, 1200)).toBe(0);
  });

  it('occupancyRate / percent 不出现 NaN 或 Infinity', () => {
    expect(occupancyRate(3, 4)).toBe(75);
    expect(occupancyRate(0, 0)).toBe(0);
    expect(percent(1, 0)).toBe(0);
  });

  it('bucketMonthlyRevenue 按业务月归集并给缺失月份补 0', () => {
    const result = bucketMonthlyRevenue(
      ['2026-08', '2026-09', '2026-10'],
      [
        { amount: 100, paidAt: new Date('2026-09-05T10:00:00Z') },
        { amount: 200, paidAt: new Date('2026-10-01T10:00:00Z') },
        { amount: 50, paidAt: new Date('2025-01-01T10:00:00Z') },
      ],
      () => '2026-10',
    );
    expect(result).toEqual([
      { month: '2026-08', revenue: 0 },
      { month: '2026-09', revenue: 0 },
      { month: '2026-10', revenue: 350 },
    ]);
  });

  it('口径常量覆盖出账/收款/未收/收缴率/出租率/趋势', () => {
    expect(Object.keys(METRIC_CALIBERS)).toEqual(
      expect.arrayContaining(['billed', 'paid', 'remaining', 'collectionRate', 'occupancyRate', 'revenueTrend']),
    );
  });
});
