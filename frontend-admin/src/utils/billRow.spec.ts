import { describe, expect, it } from 'vitest';
import {
  canReceive,
  formatMonthDay,
  isLateFeeConfirmed,
  lateFeeDisabledReason,
  lateFeeDisplayAmount,
  lateFeeOutstanding,
  lateFeeStateOf,
  overdueDaysOf,
  paymentSummary,
  showOverdue,
  summaryToLateFee,
  unpaidOf,
} from './billRow';
import type { Bill, LateFee } from '@/types';

const baseBill = {
  id: 'b1',
  amount: 100000,
  paidAmount: 0,
  status: 'PENDING',
  dueDate: '2026-10-01',
  isOverdue: false,
  currentOverdueDays: 9,
} as unknown as Bill;

describe('账单行展示规则（T286）', () => {
  it('未缴金额不为负（溢缴按 0 计）', () => {
    expect(unpaidOf({ amount: 100000, paidAmount: 30000 } as Bill)).toBe(70000);
    expect(unpaidOf({ amount: 100000, paidAmount: 0, status: 'CANCELLED' } as Bill)).toBe(0);
    expect(paymentSummary({ amount: 100000, paidAmount: 0, status: 'CANCELLED' } as Bill)).toBe('已取消');
    expect(unpaidOf({ amount: 100000, paidAmount: 120000 } as Bill)).toBe(0);
  });

  it('逾期天数仅使用服务端当前值，缺失保持未知', () => {
    expect(overdueDaysOf({ currentOverdueDays: 4 })).toBe(4);
    expect(overdueDaysOf({})).toBeNull();
    expect(showOverdue({ status: 'PENDING', currentOverdueDays: 4 })).toBe(true);
    expect(showOverdue({ status: 'PAID', currentOverdueDays: 4 })).toBe(false);
    expect(showOverdue({ status: 'CANCELLED', currentOverdueDays: 4 })).toBe(false);
    expect(showOverdue({ status: 'PENDING' })).toBe(false);
  });

  it('收款摘要区分已结清/未付/部分缴纳', () => {
    expect(paymentSummary({ amount: 100000, paidAmount: 100000 } as Bill)).toBe('已结清');
    expect(paymentSummary({ amount: 100000, paidAmount: 0 } as Bill)).toMatch(/^未付 /);
    expect(paymentSummary({ amount: 100000, paidAmount: 40000 } as Bill)).toMatch(/^已付 .+ 未付 /);
  });

  it('只有待付/部分/逾期可收款', () => {
    expect(canReceive({ status: 'PENDING' } as Bill)).toBe(true);
    expect(canReceive({ status: 'OVERDUE' } as Bill)).toBe(true);
    expect(canReceive({ status: 'PAID' } as Bill)).toBe(false);
    expect(canReceive(null)).toBe(false);
  });

  it('滞纳金不可用原因按优先级给出', () => {
    const now = new Date('2026-10-10T00:00:00Z');
    expect(lateFeeDisabledReason({ ...baseBill, status: 'PAID' }, now)).toContain('已缴清');
    expect(lateFeeDisabledReason({ ...baseBill, status: 'CANCELLED' }, now)).toContain('已取消');
    expect(lateFeeDisabledReason({ ...baseBill, dueDate: '2026-10-20', currentOverdueDays: 0 }, now)).toContain('尚未逾期');
    expect(lateFeeDisabledReason({ ...baseBill, paidAmount: 100000 }, now)).toContain('无需计算');
    expect(lateFeeDisabledReason(baseBill, now)).toBe('');
  });

  it('滞纳金状态：未确认 / 已减免 / 已核销 / 已确认', () => {
    const fee = { suggestedAmount: 5000, confirmedAmount: null, settledAmount: null } as unknown as LateFee;
    expect(lateFeeStateOf(fee).text).toBe('未确认');
    expect(lateFeeStateOf({ ...fee, confirmedAmount: 0 } as LateFee).text).toBe('已减免');
    expect(
      lateFeeStateOf({ ...fee, confirmedAmount: 5000, settledAmount: 5000 } as LateFee).text,
    ).toBe('已核销');
    expect(lateFeeStateOf({ ...fee, confirmedAmount: 5000, settledAmount: 0 } as LateFee).text).toBe(
      '已确认',
    );
    expect(lateFeeStateOf(null).text).toBe('—');
  });

  it('滞纳金金额与未核销额', () => {
    const fee = { suggestedAmount: 3000, confirmedAmount: 5000, settledAmount: 2000 } as unknown as LateFee;
    expect(isLateFeeConfirmed(fee)).toBe(true);
    expect(lateFeeDisplayAmount(fee)).toBe(5000);
    expect(lateFeeOutstanding(fee)).toBe(3000);
    expect(lateFeeOutstanding({ ...fee, confirmedAmount: null } as LateFee)).toBe(0);
  });

  it('账单摘要适配为 LateFee；无滞纳金返回 null', () => {
    expect(summaryToLateFee({ ...baseBill, lateFeeSummary: { status: 'none' } } as Bill)).toBeNull();

    const suggested = summaryToLateFee({
      ...baseBill,
      lateFeeSummary: { status: 'suggested', suggestedAmount: 2000, overdueDays: 3, amount: 0, settledAmount: 0 },
    } as unknown as Bill);
    expect(suggested).toMatchObject({ id: 'summary-b1', confirmedAmount: null, suggestedAmount: 2000 });

    const confirmed = summaryToLateFee({
      ...baseBill,
      lateFeeSummary: { status: 'confirmed', suggestedAmount: 2000, overdueDays: 3, amount: 2000, settledAmount: 0 },
    } as unknown as Bill);
    expect(confirmed).toMatchObject({ confirmedAmount: 2000 });
  });

  it('formatMonthDay 保留空值占位', () => {
    expect(formatMonthDay('2026-10-05')).toBe('10-05');
    expect(formatMonthDay(null)).toBe('—');
  });
});
