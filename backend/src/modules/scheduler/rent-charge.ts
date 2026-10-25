import type { BusinessParts } from '../../common/business-clock/business-clock.js';

/** rentAmount 是月租金（分）。不足月先按该月四舍五入到分，再把各月相加。 */
export const RENT_ROUNDING = 'HALF_UP_PER_MONTH';

export const CYCLE_MONTHS: Record<string, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMI_ANNUAL: 6,
  ANNUAL: 12,
};

export interface RentMonthCharge {
  year: number;
  month: number;
  occupiedDays: number;
  daysInMonth: number;
  amount: number;
}

export interface RentCycleQuote {
  amount: number;
  period: string;
  periodStart: string;
  periodEnd: string;
  months: RentMonthCharge[];
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthIndex(parts: Pick<BusinessParts, 'year' | 'month'>): number {
  return parts.year * 12 + (parts.month - 1);
}

function fromIndex(index: number): { year: number; month: number } {
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function occupiedDaysInMonth(
  year: number,
  month: number,
  contractStart: BusinessParts,
  contractEnd: BusinessParts,
): number {
  const dim = daysInMonth(year, month);
  const index = year * 12 + (month - 1);
  const start = monthIndex(contractStart);
  const end = monthIndex(contractEnd);
  if (index < start || index > end) return 0;
  const from = index === start ? contractStart.day : 1;
  const to = index === end ? Math.min(contractEnd.day, dim) : dim;
  if (to < from) return 0;
  return to - from + 1;
}

export function quoteRentCycle(input: {
  monthlyRent: number;
  contractStart: BusinessParts;
  contractEnd: BusinessParts;
  anchorYear: number;
  anchorMonth: number;
  cycleMonths: number;
}): RentCycleQuote | null {
  if (input.monthlyRent <= 0 || input.cycleMonths <= 0) return null;
  const months: RentMonthCharge[] = [];
  const anchor = monthIndex({ year: input.anchorYear, month: input.anchorMonth });
  for (let offset = 0; offset < input.cycleMonths; offset += 1) {
    const { year, month } = fromIndex(anchor + offset);
    const dim = daysInMonth(year, month);
    const occupiedDays = occupiedDaysInMonth(year, month, input.contractStart, input.contractEnd);
    if (occupiedDays <= 0) continue;
    const amount = occupiedDays === dim
      ? input.monthlyRent
      : Math.round((input.monthlyRent * occupiedDays) / dim);
    months.push({ year, month, occupiedDays, daysInMonth: dim, amount });
  }
  if (months.length === 0) return null;
  const first = months[0]!;
  const last = months[months.length - 1]!;
  const periodStart = isoDate(
    first.year,
    first.month,
    monthIndex(first) === monthIndex(input.contractStart) ? input.contractStart.day : 1,
  );
  const periodEnd = isoDate(
    last.year,
    last.month,
    monthIndex(last) === monthIndex(input.contractEnd)
      ? Math.min(input.contractEnd.day, last.daysInMonth)
      : last.daysInMonth,
  );
  return {
    amount: months.reduce((sum, month) => sum + month.amount, 0),
    period: `${input.anchorYear}-${String(input.anchorMonth).padStart(2, '0')}`,
    periodStart,
    periodEnd,
    months,
  };
}

/** 起始月为锚点，补齐截至业务月的全部已到期账期。未来账期不生成。 */
export function dueAnchorMonths(input: {
  contractStart: BusinessParts;
  contractEnd: BusinessParts;
  cycleMonths: number;
  asOf: BusinessParts;
}): Array<{ year: number; month: number }> {
  const start = monthIndex(input.contractStart);
  const end = monthIndex(input.contractEnd);
  const asOf = monthIndex(input.asOf);
  const anchors: Array<{ year: number; month: number }> = [];
  for (let index = start; index <= asOf && index <= end; index += input.cycleMonths) {
    anchors.push(fromIndex(index));
  }
  return anchors;
}
