export const SYSTEM_OPERATOR = 'system';
export const TIMEZONE = 'Asia/Shanghai';
export const MS_PER_DAY = 86_400_000;
export const NOTIFICATION_RETENTION_DAYS = 180;

/** 获取业务时区（Asia/Shanghai）的年月日 */
export function getBusinessDateParts(date: Date = new Date(), timeZone: string = TIMEZONE): {
  year: number;
  month: number;
  day: number;
} {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  let year = date.getUTCFullYear();
  let month = date.getUTCMonth() + 1;
  let day = date.getUTCDate();
  for (const part of parts) {
    if (part.type === 'year') year = parseInt(part.value, 10);
    if (part.type === 'month') month = parseInt(part.value, 10);
    if (part.type === 'day') day = parseInt(part.value, 10);
  }
  return { year, month, day };
}

/** 今日零点（按 Asia/Shanghai 业务日历日期的 00:00:00 UTC，与 @db.Date 存储一致） */
export function startOfTodayUtc(now: Date = new Date()): Date {
  const { year, month, day } = getBusinessDateParts(now);
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * 当前 UTC 自然日的零点。
 *
 * 用于「同一收件人当天只发一次」这类与 `createdAt`（真实时间戳）比较的场景：
 * 业务日零点（startOfTodayUtc）在凌晨 01:00 上海执行时落在**未来**，
 * 拿它去比 `createdAt >= today` 永远不成立（T208 修正）。
 */
export function startOfUtcDay(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** 自然日差值（to - from，按 UTC 日历日） */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/** YYYY-MM-DD（UTC） */
export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 分 → 元（两位小数） */
export function formatAmount(amountInCents: number): string {
  return (amountInCents / 100).toFixed(2);
}
