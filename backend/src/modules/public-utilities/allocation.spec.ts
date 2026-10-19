import { describe, it, expect } from 'vitest';
import { allocateByArea } from './allocation.js';

const base = (contractId: string, area: number) => ({
  contractId,
  roomId: `room-${contractId}`,
  baseAreaHundredths: Math.round(area * 100),
});

describe('allocateByArea', () => {
  it('按面积比例分摊', () => {
    const result = allocateByArea(30000, [base('a', 30), base('b', 20), base('c', 50)]);
    expect(result.map((entry) => entry.amount)).toEqual([9000, 6000, 15000]);
  });

  it('合计始终等于总额（余数补给基数最大的一笔）', () => {
    const result = allocateByArea(10000, [base('a', 33.33), base('b', 33.33), base('c', 33.34)]);
    expect(result.reduce((sum, entry) => sum + entry.amount, 0)).toBe(10000);
    expect(result[2].amount).toBeGreaterThanOrEqual(result[0].amount);
  });

  it('单个合同拿走全部', () => {
    expect(allocateByArea(12345, [base('a', 25)]).map((entry) => entry.amount)).toEqual([12345]);
  });

  it('总额为 0 或没有基数时全部为 0', () => {
    expect(allocateByArea(0, [base('a', 25)])[0].amount).toBe(0);
    expect(allocateByArea(1000, [])).toEqual([]);
  });

  it('基数全为 0 时不分摊（不除零）', () => {
    expect(allocateByArea(1000, [{ contractId: 'a', roomId: 'r', baseAreaHundredths: 0 }])[0].amount).toBe(0);
  });

  it('不会出现负数分摊', () => {
    const result = allocateByArea(1, [base('a', 10), base('b', 20)]);
    expect(result.every((entry) => entry.amount >= 0)).toBe(true);
    expect(result.reduce((sum, entry) => sum + entry.amount, 0)).toBe(1);
  });
});
