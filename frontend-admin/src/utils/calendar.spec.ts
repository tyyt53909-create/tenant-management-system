import { describe, expect, it } from 'vitest';
import { calendarDays, calendarKey } from './calendar';

describe('运营月历', () => {
  it('以周一为首列，正确显示月份的实际天数', () => {
    const days = calendarDays(2026, 9);
    expect(days.slice(0, 3)).toEqual([null, null, null]);
    expect(days.filter(Boolean)).toHaveLength(31);
    expect(days.at(-1)).toBe(31);
  });
  it('支持闰年二月与跨年月份', () => {
    expect(calendarDays(2028, 1).filter(Boolean)).toHaveLength(29);
    expect(calendarKey(2027, 0, 3)).toBe('2027-01-03');
  });
});
