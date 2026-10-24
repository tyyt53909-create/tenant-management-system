import {
  MS_PER_DAY,
  formatBusinessDate,
  getBusinessParts,
  parseDateOnly,
  startOfBusinessDayUtc,
} from '../../common/business-clock/business-clock.js';

export const SYSTEM_OPERATOR = 'system';
export const TIMEZONE = 'Asia/Shanghai';
export { MS_PER_DAY };
export const NOTIFICATION_RETENTION_DAYS = 180;

/** 获取业务时区（Asia/Shanghai）的年月日 */
export function getBusinessDateParts(
  date: Date = new Date(),
  timeZone: string = TIMEZONE,
): {
  year: number;
  month: number;
  day: number;
} {
  return getBusinessParts(date, timeZone);
}

/** 今日零点（按 Asia/Shanghai 业务日历日期的 00:00:00 UTC，与 @db.Date 存储一致） */
export function startOfTodayUtc(now: Date = new Date()): Date {
  return startOfBusinessDayUtc(now, TIMEZONE);
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

/** YYYY-MM-DD（业务时区） */
export function formatDate(date: Date): string {
  return formatBusinessDate(date, TIMEZONE);
}

/** 分 → 元（两位小数） */
export function formatAmount(amountInCents: number): string {
  return (amountInCents / 100).toFixed(2);
}

/** 解析 yyyy-MM-dd（UTC 零点）；供导入/调度共用。 */
export function parseBusinessDate(value: string): Date | null {
  return parseDateOnly(value);
}
