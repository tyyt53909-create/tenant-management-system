import { describe, expect, it } from 'vitest';
import { calculateCurrentAging, type AgingBill } from './current-aging.util.js';

const today = new Date('2026-10-29T00:00:00Z');
const bill = (days: number, patch: Partial<AgingBill> = {}): AgingBill => ({
  id: `b${days}`, billNumber: `B${days}`, billType: 'RENT', status: 'PENDING', amount: 1000, paidAmount: 0,
  dueDate: new Date(today.getTime() - days * 86400000), paymentRecords: [], lateFees: [], ...patch,
});
describe('current aging calculation', () => {
  it('places due-today and day boundaries without mixing confirmed fees into principal', () => {
    const bills = [-1, 0, 1, 30, 31, 60, 61, 90, 91].map(d => bill(d));
    bills[0].lateFees = [{ confirmedAmount: 200, settledAmount: 0 }, { confirmedAmount: null, settledAmount: null }];
    const rent = calculateCurrentAging(bills, today)[0];
    expect(Object.values(rent.buckets).map(c => c.count)).toEqual([2, 2, 2, 2, 1]);
    expect(rent.principal).toBe(9000);
    expect(rent.lateFee).toBe(200);
  });
  it('separates types and excludes cancelled and paid principal', () => {
    const p = { status: 'CONFIRMED' as const, amount: 1000, billPortion: 1000, lateFeePortion: 0, allocationVerified: true };
    const rows = [bill(1, { billType: 'UTILITY' }), bill(1, { billType: 'OTHER' }), bill(1, { status: 'CANCELLED' }), bill(1, { status: 'PAID', paidAmount: 1000, paymentRecords: [p] })];
    const groups = calculateCurrentAging(rows, today);
    expect(groups.map(g => g.principal)).toEqual([0, 1000, 0, 1000, 0]);
  });
  it('flags unverified allocation and inconsistent fees instead of asserting zero', () => {
    const rent = calculateCurrentAging([bill(1, { paidAmount: 200, status: 'PARTIAL', lateFees: [{ confirmedAmount: 10, settledAmount: 20 }] })], today)[0];
    expect(rent.unknownPrincipalCount).toBe(1);
    expect(rent.unknownLateFeeCount).toBe(1);
    expect(rent.principalCount).toBe(0);
  });
  it('uses current paidAmount after a verified refund and keeps settled fees separate', () => {
    const payment = { status: 'CONFIRMED' as const, amount: 1200, billPortion: 1000, lateFeePortion: 200, allocationVerified: true };
    const refund = { status: 'REVERSAL' as const, amount: -500, billPortion: -400, lateFeePortion: -100, allocationVerified: true };
    const rent = calculateCurrentAging([bill(31, { status:'PARTIAL', paidAmount:600, paymentRecords:[payment, refund], lateFees:[{confirmedAmount:200, settledAmount:100}] })], today)[0];
    expect(rent.buckets.DAYS_31_60.amount).toBe(400);
    expect(rent.lateFee).toBe(100);
    expect(rent.unknownPrincipalCount).toBe(0);
    expect(rent.unknownLateFeeCount).toBe(0);
  });
  it('marks mismatched fee allocation as unknown', () => {
    const rent = calculateCurrentAging([bill(1, { lateFees:[{confirmedAmount:200, settledAmount:100}] })], today)[0];
    expect(rent.unknownLateFeeCount).toBe(1);
    expect(rent.lateFee).toBe(0);
  });

  it('recognizes only linked exact pure voids and flags missing fee rows', () => {
    const original = {id:'p', status:'VOIDED' as const, amount:1100, billPortion:1000, lateFeePortion:100, allocationVerified:true, refundRecords:[]};
    const reversal = {id:'r', status:'REVERSAL' as const, amount:-1100, billPortion:-1000, lateFeePortion:-100, allocationVerified:null, reversalOfId:'p', refundReversalId:null};
    const known = calculateCurrentAging([bill(1, {paymentRecords:[original,reversal]})], today)[0];
    expect(known.principal).toBe(1000);
    const unknown = calculateCurrentAging([bill(1, {paymentRecords:[original,{...reversal,reversalOfId:null}]})], today)[0];
    expect(unknown.unknownPrincipalCount).toBe(1);
    const missing = calculateCurrentAging([bill(1, {paymentRecords:[{...original,status:'CONFIRMED',billPortion:0,amount:100}]})], today)[0];
    expect(missing.unknownLateFeeCount).toBe(1);
  });

});
