import { describe, expect, it } from 'vitest';
import { computeOverdue, dailyLateFeeAmount, derivePaymentStatus } from './bill-overdue.util.js';

describe('账单逾期与滞纳金日增（T272）', () => {
  it('缴付进度只由金额决定，不再返回 OVERDUE', () => {
    expect(derivePaymentStatus(1000, 0)).toBe('PENDING');
    expect(derivePaymentStatus(1000, 400)).toBe('PARTIAL');
    expect(derivePaymentStatus(1000, 1000)).toBe('PAID');
  });

  it('逾期天数按自然日，到期当天不算逾期', () => {
    const due = new Date('2026-10-10T00:00:00Z');
    expect(computeOverdue(due, new Date('2026-10-10T00:00:00Z'))).toEqual({
      isOverdue: false,
      overdueDays: 0,
    });
    expect(computeOverdue(due, new Date('2026-10-13T00:00:00Z'))).toEqual({
      isOverdue: true,
      overdueDays: 3,
    });
    expect(computeOverdue(undefined as never, new Date())).toEqual({
      isOverdue: false,
      overdueDays: 0,
    });
  });

  it('每日增量 = 累计应付(today) − 累计应付(yesterday)', () => {
    const rule = { fixedDaily: 100 };
    expect(dailyLateFeeAmount(rule, 100000, 1)).toBe(100);
    expect(dailyLateFeeAmount(rule, 100000, 5)).toBe(100);
    expect(dailyLateFeeAmount({ dailyRate: 0.001 }, 100000, 3)).toBe(100);
    expect(dailyLateFeeAmount(null, 100000, 3)).toBe(0);
    expect(dailyLateFeeAmount(rule, 0, 3)).toBe(0);
  });

  it('宽限期内日增量为 0，封顶后不再增加', () => {
    expect(dailyLateFeeAmount({ graceDays: 3, fixedDaily: 100 }, 100000, 3)).toBe(0);
    expect(dailyLateFeeAmount({ graceDays: 3, fixedDaily: 100 }, 100000, 4)).toBe(100);

    const capped = { fixedDaily: 1000, cap: 1500 };
    expect(dailyLateFeeAmount(capped, 100000, 1)).toBe(1000);
    expect(dailyLateFeeAmount(capped, 100000, 2)).toBe(500);
    expect(dailyLateFeeAmount(capped, 100000, 3)).toBe(0);
  });
});
