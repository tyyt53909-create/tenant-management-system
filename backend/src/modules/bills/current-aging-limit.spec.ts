import { describe, expect, it, vi } from 'vitest';
import { BillsService } from './bills.service.js';
describe('current aging bound', () => {
  it('rejects an oversized scope instead of returning a partial total', async () => {
    const findMany = vi.fn().mockResolvedValue(Array(5001).fill({}));
    const prisma = { $transaction: (fn: any) => fn({ bill: { findMany } }) };
    const service = new BillsService(prisma as any, {} as any, {} as any, {} as any);
    const clock = { now: () => new Date(), formatDate: () => '2026-10-29', todayUtc: () => new Date('2026-10-29') };
    await expect(service.currentAging({}, clock as any)).rejects.toThrow('账单超过 5000 条');
    expect(findMany.mock.calls[0][0].take).toBe(5001);
  });
});
