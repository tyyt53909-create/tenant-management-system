import type { BillStatus } from '@prisma/client';
import { LateFeeRule, LateFeeUtil } from './utils/late-fee.util.js';

/** 未缴清的缴付进度（FIN-04 / T272：不再包含 OVERDUE）。 */
export const UNPAID_BILL_STATUSES: BillStatus[] = ['PENDING', 'PARTIAL'];

/** 由金额推导缴付进度；逾期是独立维度，不在这里表达。 */
export function derivePaymentStatus(amount: number, paidAmount: number): BillStatus {
  if (paidAmount >= amount) return 'PAID';
  if (paidAmount > 0) return 'PARTIAL';
  return 'PENDING';
}

/** 按业务日计算逾期天数；未到期返回 0。 */
export function computeOverdue(
  dueDate: Date,
  today: Date,
): { isOverdue: boolean; overdueDays: number } {
  if (!(dueDate instanceof Date) || Number.isNaN(dueDate.getTime())) {
    return { isOverdue: false, overdueDays: 0 };
  }
  const overdueDays = LateFeeUtil.overdueDays(dueDate, today);
  return { isOverdue: overdueDays > 0, overdueDays: Math.max(0, overdueDays) };
}

/**
 * 当天应新增的滞纳金（分）。
 * 累计应付(today) − 累计应付(yesterday)，封顶后不会为负。
 */
export function dailyLateFeeAmount(
  rule: LateFeeRule | null | undefined,
  baseAmount: number,
  overdueDays: number,
): number {
  if (overdueDays <= 0 || baseAmount <= 0) return 0;
  const today = LateFeeUtil.calculate(rule, baseAmount, overdueDays).amount;
  const yesterday = LateFeeUtil.calculate(rule, baseAmount, overdueDays - 1).amount;
  return Math.max(0, today - yesterday);
}
