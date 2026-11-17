import { CYCLE_MONTHS, quoteRentCycle, RENT_ROUNDING } from './rent-charge.js';
import { getBusinessDateParts } from './scheduler.util.js';

export function quoteScheduledRent(
  lease: { startDate: Date; endDate: Date; paymentCycle: string; paymentDay: number; rentAmount: number; contractNumber: string },
  year: number,
  month: number,
) {
  const cycleMonths = CYCLE_MONTHS[lease.paymentCycle];
  const start = getBusinessDateParts(lease.startDate);
  const offset = (year - start.year) * 12 + month - start.month;
  if (!cycleMonths || offset < 0 || offset % cycleMonths !== 0) return null;

  const quote = quoteRentCycle({
    monthlyRent: lease.rentAmount,
    contractStart: start,
    contractEnd: getBusinessDateParts(lease.endDate),
    anchorYear: year,
    anchorMonth: month,
    cycleMonths,
  });
  if (!quote) return null;
  return {
    amount: quote.amount,
    period: quote.period,
    dueDate: new Date(Date.UTC(year, month - 1, Math.min(lease.paymentDay, 28))),
    snapshot: {
      rentAmount: lease.rentAmount, cycle: lease.paymentCycle,
      periodStart: quote.periodStart, periodEnd: quote.periodEnd,
      rounding: RENT_ROUNDING, months: quote.months.map((entry) => ({ ...entry })),
      paymentDay: lease.paymentDay, contractNumber: lease.contractNumber,
    },
  };
}
