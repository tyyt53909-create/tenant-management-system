import { describe, expect, it } from 'vitest';
import { canCreateExpense, canRecordPayment } from './validation';
describe('支出表单', () => {
  it('requires a source and a positive integer amount', () => {
    const valid = { buildingId: 'b', category: '维修', description: '灯具', amount: 100, sourceReference: 'invoice', publicUtilityBillId: '' };
    expect(canCreateExpense(valid)).toBe(true);
    expect(canCreateExpense({ ...valid, sourceReference: ' ' })).toBe(false);
    expect(canCreateExpense({ ...valid, amount: 0.5 })).toBe(false);
  });
  it('requires a payment date and evidence', () => {
    expect(canRecordPayment({ paidDate: '2026-01-01', evidence: 'bank 123' })).toBe(true);
    expect(canRecordPayment({ paidDate: '2026-01-01', evidence: ' ' })).toBe(false);
  });
});
