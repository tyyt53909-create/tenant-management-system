/**
 * 滞纳金计算（docs/02-数据模型.md §2.9、docs/04-状态机.md §3.4、docs/07-测试策略.md）
 *
 * 规则存于合同 `lateFeeRule`（JSON，金额单位为分）：
 *   { "graceDays": 3, "dailyRate": 0.003, "fixedDaily": null, "cap": 50000 }
 *
 * - graceDays  宽限天数（逾期前 N 天不计收）
 * - dailyRate  按日比例（与 fixedDaily 二选一，优先 dailyRate）
 * - fixedDaily 固定金额（分/天）
 * - cap        封顶金额（分），可选
 */

export interface LateFeeRule {
  graceDays?: number;
  dailyRate?: number | null;
  fixedDaily?: number | null;
  cap?: number | null;
}

export type NormalizedLateFeeRule = {
  graceDays: number;
  dailyRate: number | null;
  fixedDaily: number | null;
  cap: number | null;
};

export interface LateFeeCalculation {
  /** 建议滞纳金（分，已封顶） */
  amount: number;
  /** 封顶前金额（分） */
  rawAmount: number;
  /** 逾期天数（自然日） */
  overdueDays: number;
  /** 计费天数（逾期天数 − 宽限天数，最小 0） */
  effectiveDays: number;
  /** 计费基数（未缴金额，分） */
  baseAmount: number;
  /** 是否触发封顶 */
  capped: boolean;
  /** 归一化后的规则（随计算过程写入 LateFee.calculation） */
  rule: NormalizedLateFeeRule;
}

export class LateFeeUtil {
  /**
   * 计算建议滞纳金（不自动入账，仅供管理者确认）
   */
  static calculate(
    rule: LateFeeRule | null | undefined,
    baseAmount: number,
    overdueDays: number,
  ): LateFeeCalculation {
    const normalized: NormalizedLateFeeRule = {
      graceDays: Math.max(0, Math.floor(rule?.graceDays ?? 0)),
      dailyRate: typeof rule?.dailyRate === 'number' ? rule.dailyRate : null,
      fixedDaily: typeof rule?.fixedDaily === 'number' ? rule.fixedDaily : null,
      cap: typeof rule?.cap === 'number' ? rule.cap : null,
    };

    const days = Math.max(0, Math.floor(overdueDays));
    const effectiveDays = Math.max(0, days - normalized.graceDays);
    const base = Math.max(0, baseAmount);

    let rawAmount = 0;
    if (effectiveDays > 0 && base > 0) {
      if (normalized.dailyRate !== null && normalized.dailyRate > 0) {
        rawAmount = Math.round(base * normalized.dailyRate * effectiveDays);
      } else if (normalized.fixedDaily !== null && normalized.fixedDaily > 0) {
        rawAmount = Math.round(normalized.fixedDaily * effectiveDays);
      }
    }

    const capped = normalized.cap !== null && rawAmount > normalized.cap;
    const amount = capped ? (normalized.cap as number) : rawAmount;

    return {
      amount,
      rawAmount,
      overdueDays: days,
      effectiveDays,
      baseAmount: base,
      capped,
      rule: normalized,
    };
  }

  /**
   * 逾期天数（按自然日，到期日当天不算逾期）
   *
   * dueDate 为数据库 `@db.Date`（UTC 零点），统一按 UTC 日历日计算，避免服务器时区偏差。
   * 返回值最小为 0（未到期返回 0）。
   */
  static overdueDays(dueDate: Date, now: Date = new Date()): number {
    const due = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return Math.max(0, Math.floor((today - due) / 86_400_000));
  }
}
