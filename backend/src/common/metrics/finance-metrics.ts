/**
 * 财务指标口径（FIN-10 / T275）。
 *
 * 这里只放**纯函数**，不碰 Prisma、不读时钟：
 * - 出账（billed）：账单 `amount` 合计，账单时间基准由调用方决定（统计页用 `dueDate`，管理摘要是全量）。
 * - 收款（paid）：收款 `amount` 合计；区间报表用 `paidAt`，管理摘要用账单 `paidAmount`。
 * - 收缴率：`paid / billed`，保留 1 位小数；分母为 0 返回 `null`（页面显示「—」）。
 * - 出租率：占用房间 / 房间总数，保留 1 位小数。
 *
 * 任何新页面要展示这些指标时必须复用本文件，不得再写一套除法。
 */

export const METRIC_CALIBERS = {
  billed: '账单应收：账单 amount 合计，排除 CANCELLED；区间报表以 dueDate 归期',
  paid: '已收：收款 amount 合计，区间报表以 paidAt 归期；管理摘要用账单 paidAmount',
  remaining: '未收：max(0, billed - paid)；不含另计滞纳金',
  collectionRate: '收缴率 = paid / billed，保留 1 位小数；billed 为 0 时返回 null',
  occupancyRate: '出租率 = 区间末存在有效合同的房间数 / 房间总数，保留 1 位小数',
  revenueTrend: '收入趋势：按 PaymentRecord.paidAt 的业务月归集，单位分',
} as const;

export interface RevenuePayment {
  amount: number;
  paidAt: Date | string;
}

/** 安全求和：忽略非数字，按分取整。 */
export function sumAmounts<T>(rows: readonly T[], pick: (row: T) => number | null | undefined): number {
  return rows.reduce<number>((sum, row) => {
    const value = Number(pick(row));
    return sum + (Number.isFinite(value) ? Math.round(value) : 0);
  }, 0);
}

/** 百分比，保留 1 位小数；分母 <= 0 时返回 0（出租率这类「无房间」场景）。 */
export function percent(part: number, total: number, digits = 1): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  const factor = 10 ** digits;
  return Math.round((part / total) * 100 * factor) / factor;
}

/** 收缴率；出账为 0 时返回 null，让页面显示「—」而不是 0%。 */
export function collectionRate(billed: number, paid: number): number | null {
  if (!Number.isFinite(billed) || billed <= 0) return null;
  return percent(paid, billed);
}

/** 未收金额；不允许负数（溢缴不冲减应收）。 */
export function remainingAmount(billed: number, paid: number): number {
  const value = Math.round(Number(billed) || 0) - Math.round(Number(paid) || 0);
  return Math.max(0, value);
}

/** 出租率（占用 / 总数）。 */
export function occupancyRate(occupied: number, total: number): number {
  return percent(occupied, total);
}

/**
 * 按业务月归集收款。
 * @param monthKeys 需要输出的月份（`YYYY-MM`，从早到晚），未出现的月份补 0
 * @param payments 收款记录
 * @param monthKeyOf 把 Date 转业务月的函数（通常是 `clock.monthKey`）
 */
export function bucketMonthlyRevenue(
  monthKeys: readonly string[],
  payments: readonly RevenuePayment[],
  monthKeyOf: (date: Date) => string,
): Array<{ month: string; revenue: number }> {
  const buckets = new Map<string, number>(monthKeys.map((key) => [key, 0]));
  for (const payment of payments) {
    const key = monthKeyOf(new Date(payment.paidAt));
    const current = buckets.get(key);
    if (current !== undefined) {
      buckets.set(key, current + Math.round(Number(payment.amount) || 0));
    }
  }
  return [...buckets].map(([month, revenue]) => ({ month, revenue }));
}
