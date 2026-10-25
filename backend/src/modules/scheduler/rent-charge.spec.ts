import { describe, expect, it } from 'vitest';
import { dueAnchorMonths, quoteRentCycle } from './rent-charge.js';

const rent = 300_000;

describe('quoteRentCycle', () => {
  it('完整月、季、半年、年按月租金累加', () => {
    const start = { year: 2026, month: 1, day: 1 };
    const end = { year: 2026, month: 12, day: 31 };
    expect(quoteRentCycle({ monthlyRent: rent, contractStart: start, contractEnd: end, anchorYear: 2026, anchorMonth: 1, cycleMonths: 1 })?.amount).toBe(300_000);
    expect(quoteRentCycle({ monthlyRent: rent, contractStart: start, contractEnd: end, anchorYear: 2026, anchorMonth: 1, cycleMonths: 3 })?.amount).toBe(900_000);
    expect(quoteRentCycle({ monthlyRent: rent, contractStart: start, contractEnd: end, anchorYear: 2026, anchorMonth: 1, cycleMonths: 6 })?.amount).toBe(1_800_000);
    expect(quoteRentCycle({ monthlyRent: rent, contractStart: start, contractEnd: end, anchorYear: 2026, anchorMonth: 1, cycleMonths: 12 })?.amount).toBe(3_600_000);
  });

  it('平年 2 月 15–28 日按该月 28 天折半，四舍五入发生在单月', () => {
    const quote = quoteRentCycle({
      monthlyRent: rent,
      contractStart: { year: 2026, month: 2, day: 15 },
      contractEnd: { year: 2026, month: 2, day: 28 },
      anchorYear: 2026,
      anchorMonth: 2,
      cycleMonths: 1,
    });
    expect(quote?.amount).toBe(150_000);
    expect(quote?.months).toEqual([
      { year: 2026, month: 2, occupiedDays: 14, daysInMonth: 28, amount: 150_000 },
    ]);
  });

  it('季付不足月只折算不完整的月份', () => {
    const quote = quoteRentCycle({
      monthlyRent: 90_000,
      contractStart: { year: 2026, month: 2, day: 15 },
      contractEnd: { year: 2027, month: 12, day: 31 },
      anchorYear: 2026,
      anchorMonth: 2,
      cycleMonths: 3,
    });
    expect(quote?.amount).toBe(225_000);
  });
});

describe('dueAnchorMonths', () => {
  it('补齐已到期锚点，不生成未来账期', () => {
    expect(dueAnchorMonths({
      contractStart: { year: 2026, month: 2, day: 15 },
      contractEnd: { year: 2026, month: 12, day: 31 },
      cycleMonths: 3,
      asOf: { year: 2026, month: 5, day: 15 },
    })).toEqual([
      { year: 2026, month: 2 },
      { year: 2026, month: 5 },
    ]);
  });
});
