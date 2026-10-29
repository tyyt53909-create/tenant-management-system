import type { BillStatus, BillType } from '@prisma/client';
import { computeOverdue } from './bill-overdue.util.js';

export const AGING_BUCKETS = ['CURRENT', 'DAYS_1_30', 'DAYS_31_60', 'DAYS_61_90', 'DAYS_91_PLUS'] as const;
export type AgingBucket = typeof AGING_BUCKETS[number];
type Payment = { status: 'CONFIRMED' | 'VOIDED' | 'REVERSAL'; allocationVerified: boolean | null; billPortion: number; lateFeePortion: number; amount: number };
type Fee = { confirmedAmount: number | null; settledAmount: number | null };
export type AgingBill = { id: string; billNumber: string; billType: BillType; status: BillStatus; amount: number; paidAmount: number; dueDate: Date; paymentRecords: Payment[]; lateFees: Fee[] };
type Cell = { amount: number; count: number; billIds: string[] };
const safeAdd = (a: number, b: number) => {
  const result = a + b;
  if (!Number.isSafeInteger(result)) throw new Error('账龄金额超出安全整数范围');
  return result;
};
function bucket(days: number): AgingBucket {
  return days <= 0 ? 'CURRENT' : days <= 30 ? 'DAYS_1_30' : days <= 60 ? 'DAYS_31_60' : days <= 90 ? 'DAYS_61_90' : 'DAYS_91_PLUS';
}

/** Current amounts only. Unknown records are excluded from numeric subtotals and counted explicitly. */
export function calculateCurrentAging(bills: AgingBill[], today: Date) {
  const types: BillType[] = ['RENT', 'UTILITY', 'DEPOSIT', 'OTHER', 'MAINTENANCE'];
  const groups = types.map(type => ({
    billType: type,
    buckets: Object.fromEntries(AGING_BUCKETS.map(key => [key, { amount: 0, count: 0, billIds: [] }])) as unknown as Record<AgingBucket, Cell>,
    principal: 0, principalCount: 0, unknownPrincipalCount: 0, unknownPrincipalIds: [] as string[],
    lateFee: 0, lateFeeCount: 0, unknownLateFeeCount: 0, unknownLateFeeIds: [] as string[],
  }));
  for (const bill of bills) {
    if (bill.status === 'CANCELLED') continue;
    const group = groups.find(g => g.billType === bill.billType);
    if (!group) throw new Error('未知账单类型');
    const validAmounts = Number.isSafeInteger(bill.amount) && Number.isSafeInteger(bill.paidAmount) && bill.amount >= 0 && bill.paidAmount >= 0 && bill.paidAmount <= bill.amount;
    const validStatus = validAmounts && (bill.status === 'PAID' ? bill.paidAmount === bill.amount : bill.status === 'PENDING' ? bill.paidAmount === 0 && bill.amount > 0 : bill.status === 'PARTIAL' ? bill.paidAmount > 0 && bill.paidAmount < bill.amount : bill.paidAmount < bill.amount);
    const validDate = bill.dueDate instanceof Date && !Number.isNaN(bill.dueDate.getTime());
    const validPayments = bill.paymentRecords.every(p => p.allocationVerified === true && Number.isSafeInteger(p.amount) && Number.isSafeInteger(p.billPortion) && Number.isSafeInteger(p.lateFeePortion) && p.billPortion + p.lateFeePortion === p.amount && (p.status === 'REVERSAL' ? p.amount < 0 && p.billPortion <= 0 && p.lateFeePortion <= 0 : p.amount > 0 && p.billPortion >= 0 && p.lateFeePortion >= 0));
    const allocated = bill.paymentRecords.reduce((sum, p) => safeAdd(sum, p.billPortion), 0);
    const verified = validAmounts && validStatus && validDate && validPayments && allocated === bill.paidAmount;
    if (!verified) { group.unknownPrincipalCount++; group.unknownPrincipalIds.push(bill.id); }
    else if (bill.amount > bill.paidAmount) {
      const amount = bill.amount - bill.paidAmount;
      const cell = group.buckets[bucket(computeOverdue(bill.dueDate, today).overdueDays)];
      cell.amount = safeAdd(cell.amount, amount); cell.count++; cell.billIds.push(bill.id);
      group.principal = safeAdd(group.principal, amount); group.principalCount++;
    }
    const allocatedFees = bill.paymentRecords.reduce((sum, p) => safeAdd(sum, p.lateFeePortion), 0);
    const settledFees = bill.lateFees.reduce((sum, fee) => safeAdd(sum, fee.settledAmount ?? 0), 0);
    const feesReconciled = validPayments && allocatedFees === settledFees;
    for (const fee of bill.lateFees) {
      if (fee.confirmedAmount === null) {
        if ((fee.settledAmount ?? 0) !== 0) { group.unknownLateFeeCount++; group.unknownLateFeeIds.push(bill.id); }
        continue;
      }
      const settled = fee.settledAmount ?? 0;
      if (!feesReconciled || !Number.isSafeInteger(fee.confirmedAmount) || !Number.isSafeInteger(settled) || fee.confirmedAmount < 0 || settled < 0 || settled > fee.confirmedAmount) {
        group.unknownLateFeeCount++; group.unknownLateFeeIds.push(bill.id); continue;
      }
      const outstanding = fee.confirmedAmount - settled;
      if (outstanding > 0) { group.lateFee = safeAdd(group.lateFee, outstanding); group.lateFeeCount++; }
    }
  }
  return groups;
}
