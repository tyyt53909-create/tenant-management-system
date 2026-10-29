import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateExpenseDto, RecordExpensePaymentDto } from './dto/expense.dto.js';
describe('expense DTO', () => {
  it('rejects fractional, negative and out-of-range amounts', async () => {
    for (const amount of [0, -1, 1.5, 2147483648]) {
      const dto = plainToInstance(CreateExpenseDto, { buildingId: 'b', category: 'c', description: 'd', requestKey: 'k', amount });
      expect((await validate(dto)).some(e => e.property === 'amount')).toBe(true);
    }
  });
  it('requires a date-only string and evidence', async () => {
    const dto = plainToInstance(RecordExpensePaymentDto, { amount: 1, paidDate: '2026-01-01T00:00:00Z', evidence: '', requestKey: 'k' });
    const errors = await validate(dto); expect(errors.map(e => e.property)).toEqual(expect.arrayContaining(['paidDate', 'evidence']));
  });
});
