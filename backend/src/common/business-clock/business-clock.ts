/**
 * 业务日期纯函数（FIN-09 / ISS-11）。
 *
 * 口径：
 * - 「业务日」由 `BUSINESS_TIMEZONE`（默认 Asia/Shanghai）决定；
 * - 数据库 `@db.Date` 用 UTC 零点表示业务日，因此所有「日」都归一化为
 *   `Date.UTC(year, month - 1, day)`，不依赖进程 TZ；
 * - 月/季/年范围同样用 UTC 边界，避免容器 `TZ=UTC` 与本地 `Asia/Shanghai` 结果不同。
 */
export const DEFAULT_BUSINESS_TIMEZONE = 'Asia/Shanghai';
export const MS_PER_DAY = 86_400_000;

export interface BusinessParts {
  year: number;
  month: number;
  day: number;
}

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || typeof timeZone !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function getBusinessParts(
  date: Date = new Date(),
  timeZone: string = DEFAULT_BUSINESS_TIMEZONE,
): BusinessParts {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date);

  let year = date.getUTCFullYear();
  let month = date.getUTCMonth() + 1;
  let day = date.getUTCDate();
  for (const part of formatted) {
    if (part.type === 'year') year = Number(part.value);
    if (part.type === 'month') month = Number(part.value);
    if (part.type === 'day') day = Number(part.value);
  }
  return { year, month, day };
}

/** 业务日对应的 UTC 零点（用于 @db.Date 比较/写入）。 */
export function startOfBusinessDayUtc(
  date: Date = new Date(),
  timeZone: string = DEFAULT_BUSINESS_TIMEZONE,
): Date {
  const { year, month, day } = getBusinessParts(date, timeZone);
  return new Date(Date.UTC(year, month - 1, day));
}

/** 业务日 YYYY-MM-DD。 */
export function formatBusinessDate(
  date: Date = new Date(),
  timeZone: string = DEFAULT_BUSINESS_TIMEZONE,
): string {
  const { year, month, day } = getBusinessParts(date, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * 业务时区的日期时间 YYYY-MM-DD HH:mm:ss。
 *
 * 用于导出里的 `createdAt` 等真实时间戳：`toLocaleString()` 依赖进程 TZ，
 * 容器（UTC）与本地（Asia/Shanghai）会导出差 8 小时的数据。
 */
export function formatBusinessDateTime(
  date: Date = new Date(),
  timeZone: string = DEFAULT_BUSINESS_TIMEZONE,
): string {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const pick = (type: string): string =>
    formatted.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}:${pick('second')}`;
}

/** 业务月 YYYY-MM。 */
export function businessMonthKey(
  date: Date = new Date(),
  timeZone: string = DEFAULT_BUSINESS_TIMEZONE,
): string {
  const { year, month } = getBusinessParts(date, timeZone);
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/** 按 UTC 日历日做月份加减，日期溢出时回退到目标月最后一天（与 Date.UTC 行为一致）。 */
export function addUtcMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
}

export function startOfMonthUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** 当月最后一天 23:59:59.999（UTC），用于闭区间查询。 */
export function endOfMonthUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

export function startOfQuarterUtc(date: Date): Date {
  const quarterStartMonth = Math.floor(date.getUTCMonth() / 3) * 3;
  return new Date(Date.UTC(date.getUTCFullYear(), quarterStartMonth, 1));
}

export function endOfQuarterUtc(date: Date): Date {
  const quarterStartMonth = Math.floor(date.getUTCMonth() / 3) * 3;
  return new Date(Date.UTC(date.getUTCFullYear(), quarterStartMonth + 3, 0, 23, 59, 59, 999));
}

export function startOfYearUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
}

export function endOfYearUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), 11, 31, 23, 59, 59, 999));
}

/** 自然日差值（to - from，按 UTC 日历日）。 */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/** 严格解析 yyyy-MM-dd 为 UTC 零点；非法日期返回 null（不随进程 TZ 变化）。 */
export function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return parsed;
}
