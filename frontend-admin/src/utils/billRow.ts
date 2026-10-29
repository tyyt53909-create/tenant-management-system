import type { Bill, LateFee } from '@/types';
import { formatMoney, formatDateOnly } from '@/utils/table';

/**
 * 账单行的展示规则（FE-01 / T286：从 636 行的 `views/bills/index.vue` 抽出纯函数）。
 *
 * 这些判断（是否逾期、未付多少、滞纳金状态）原先散在 SFC 里，只能靠 Playwright 间接验证；
 * 抽成纯函数后可直接单测，页面只保留交互与布局。
 */

export const BILL_TYPE_LABEL: Record<string, string> = {
  RENT: '租金',
  UTILITY: '水电费',
  OTHER: '其他',
};

export const BILL_STATUS_LABEL: Record<string, string> = {
  PENDING: '待支付',
  PARTIAL: '部分支付',
  PAID: '已支付',
  OVERDUE: '已逾期',
  CANCELLED: '已取消',
};

export const BILL_STATUS_TAG: Record<string, 'warning' | 'info' | 'success' | 'danger'> = {
  PENDING: 'warning',
  PARTIAL: 'info',
  PAID: 'success',
  OVERDUE: 'danger',
  CANCELLED: 'info',
};

/** 未缴金额（分）；溢缴时按 0 处理，不显示负数。 */
export function unpaidOf(bill: Pick<Bill, 'amount' | 'paidAmount'> & Partial<Pick<Bill, 'status'>>): number {
  return bill.status === 'CANCELLED' ? 0 : Math.max(0, bill.amount - bill.paidAmount);
}

/** 当前逾期天数由服务端业务时钟提供；缺失时不猜测。 */
export function overdueDaysOf(bill: Partial<Pick<Bill, 'currentOverdueDays'>>, _now?: Date): number | null {
  return typeof bill.currentOverdueDays === 'number' ? bill.currentOverdueDays : null;
}

export function showOverdue(bill: Pick<Bill, 'status'> & Partial<Pick<Bill, 'currentOverdueDays'>>, _now?: Date): boolean {
  return ['PENDING', 'PARTIAL', 'OVERDUE'].includes(bill.status) && (overdueDaysOf(bill) ?? 0) > 0;
}

/** 收款摘要：已结清 / 未付 / 部分缴纳。 */
export function paymentSummary(bill: Pick<Bill, 'amount' | 'paidAmount'> & Partial<Pick<Bill, 'status'>>): string {
  if (bill.status === 'CANCELLED') return '已取消';
  const unpaid = unpaidOf(bill);
  if (unpaid <= 0) return '已结清';
  if (bill.paidAmount <= 0) return `未付 ${formatMoney(unpaid)}`;
  return `已付 ${formatMoney(bill.paidAmount)} / 未付 ${formatMoney(unpaid)}`;
}

export function paymentTitle(bill: Pick<Bill, 'amount' | 'paidAmount'> & Partial<Pick<Bill, 'status'>>): string {
  return `已付 ${formatMoney(bill.paidAmount)} / 未付 ${formatMoney(unpaidOf(bill))}`;
}

export function formatMonthDay(value: unknown): string {
  const date = formatDateOnly(value);
  return date === '—' ? date : date.slice(5);
}

/** 是否还能收款：已缴清、已取消的账单不允许。 */
export function canReceive(bill: Pick<Bill, 'status'> | null): boolean {
  return !!bill && ['PENDING', 'PARTIAL', 'OVERDUE'].includes(bill.status);
}

/** 解锁滞纳金操作的原因；空串表示可操作。 */
export function lateFeeDisabledReason(
  bill: Pick<Bill, 'status' | 'amount' | 'paidAmount' | 'dueDate'> & Partial<Pick<Bill, 'currentOverdueDays'>> | null,
  now: Date = new Date(),
): string {
  if (!bill) return '';
  if (bill.status === 'PAID') return '账单已缴清，不可新增滞纳金';
  if (bill.status === 'CANCELLED') return '账单已取消，不可新增滞纳金';
  const overdue = overdueDaysOf(bill, now);
  if (overdue === null) return '逾期状态待确认';
  if (overdue <= 0) return '账单尚未逾期，无需计算滞纳金';
  if (unpaidOf(bill) <= 0) return '账单已缴清，无需计算滞纳金';
  return '';
}

export function isLateFeeConfirmed(fee: LateFee | null): boolean {
  return !!fee && fee.confirmedAmount !== null && fee.confirmedAmount !== undefined;
}

export function lateFeeOutstanding(fee: LateFee | null): number {
  if (!isLateFeeConfirmed(fee)) return 0;
  return Math.max(0, (fee!.confirmedAmount ?? 0) - (fee!.settledAmount ?? 0));
}

export function lateFeeDisplayAmount(fee: LateFee | null): number {
  return fee ? (fee.confirmedAmount ?? fee.suggestedAmount) : 0;
}

export interface LateFeeState {
  text: string;
  type: 'info' | 'warning' | 'success';
  tip: string;
}

/** 滞纳金状态文案：未确认 / 已减免 / 已核销 / 已确认。 */
export function lateFeeStateOf(fee: LateFee | null): LateFeeState {
  if (!fee) return { text: '—', type: 'info', tip: '暂无滞纳金' };
  if (!isLateFeeConfirmed(fee)) {
    return { text: '未确认', type: 'info', tip: '系统建议值，尚未入账；管理者确认后才计入应收' };
  }
  if (fee.confirmedAmount === 0) {
    return { text: '已减免', type: 'info', tip: '管理者已确认减免，滞纳金不入账' };
  }
  const outstanding = lateFeeOutstanding(fee);
  if (outstanding <= 0) {
    return {
      text: '已核销',
      type: 'success',
      tip: `已确认 ${formatMoney(fee.confirmedAmount!)}，收款时已全额核销`,
    };
  }
  return {
    text: '已确认',
    type: 'warning',
    tip: `已确认入账 ${formatMoney(fee.confirmedAmount!)}，未核销 ${formatMoney(outstanding)}`,
  };
}

/** 把账单自带的滞纳金摘要适配成 LateFee，避免列表额外发请求。 */
export function summaryToLateFee(bill: Bill): LateFee | null {
  const summary = bill.lateFeeSummary;
  if (!summary || summary.status === 'none') return null;
  const confirmed = summary.status !== 'suggested';
  return {
    id: `summary-${bill.id}`,
    billId: bill.id,
    suggestedAmount: summary.suggestedAmount,
    confirmedAmount: confirmed ? summary.amount : null,
    overdueDays: summary.overdueDays,
    calculation: null,
    notes: null,
    confirmedAt: null,
    confirmedBy: null,
    settledAmount: summary.settledAmount,
    settledAt: null,
    settledBy: null,
    createdAt: '',
  } as unknown as LateFee;
}
