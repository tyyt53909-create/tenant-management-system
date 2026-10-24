import type { Prisma, Bill } from '@prisma/client';

/**
 * 押金台账写入（FIN-03 / T267）。
 * 只在同一事务内调用：收款/冲正与账单更新必须原子。
 */

type Tx = Prisma.TransactionClient;

function statusFor(balance: number, amount: number): 'HELD' | 'PARTIAL' {
  return balance >= amount ? 'HELD' : 'PARTIAL';
}

/** 押金账单收款入账。非 DEPOSIT 账单直接忽略。 */
export async function applyDepositCollection(
  tx: Tx,
  params: { bill: Pick<Bill, 'id' | 'contractId' | 'billType'>; amount: number; operatorId: string },
): Promise<{ id: string; balance: number } | null> {
  const { bill, amount, operatorId } = params;
  if (bill.billType !== 'DEPOSIT' || amount <= 0) return null;

  const contract = await tx.contract.findUnique({
    where: { id: bill.contractId },
    select: { id: true, tenantId: true, roomId: true, depositAmount: true },
  });
  if (!contract) return null;

  const ledger = await tx.depositLedger.upsert({
    where: { contractId: bill.contractId },
    create: {
      contractId: bill.contractId,
      tenantId: contract.tenantId,
      roomId: contract.roomId,
      amount: contract.depositAmount,
      balance: 0,
      status: 'PARTIAL',
    },
    update: {},
  });

  const balance = ledger.balance + amount;
  const updated = await tx.depositLedger.update({
    where: { id: ledger.id },
    data: { balance, status: statusFor(balance, ledger.amount) },
  });

  await tx.depositTransaction.create({
    data: {
      ledgerId: ledger.id,
      type: 'COLLECT',
      amount,
      balanceAfter: balance,
      relatedType: 'BILL',
      relatedId: bill.id,
      operatorId,
      notes: '押金账单收款',
    },
  });

  return { id: updated.id, balance: updated.balance };
}

/** 押金收款冲正（作废收款时调用）。 */
export async function reverseDepositCollection(
  tx: Tx,
  params: { bill: Pick<Bill, 'id' | 'contractId' | 'billType'>; amount: number; operatorId: string },
): Promise<{ id: string; balance: number } | null> {
  const { bill, amount, operatorId } = params;
  if (bill.billType !== 'DEPOSIT' || amount <= 0) return null;

  const ledger = await tx.depositLedger.findUnique({ where: { contractId: bill.contractId } });
  if (!ledger) return null;

  const balance = Math.max(0, ledger.balance - amount);
  const updated = await tx.depositLedger.update({
    where: { id: ledger.id },
    data: { balance, status: statusFor(balance, ledger.amount) },
  });

  await tx.depositTransaction.create({
    data: {
      ledgerId: ledger.id,
      type: 'REVERSAL',
      amount: -amount,
      balanceAfter: balance,
      relatedType: 'BILL',
      relatedId: bill.id,
      operatorId,
      notes: '押金收款冲正',
    },
  });

  return { id: updated.id, balance: updated.balance };
}
