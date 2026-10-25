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

  if (ledger.balance < amount) {
    throw new Error(
      `押金余额 ${ledger.balance} 分不足以冲正 ${amount} 分，不能把不足部分夹成 0`,
    );
  }
  const balance = ledger.balance - amount;
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

/**
 * 退租结算时一次性结清押金（FIN-07 / T273）。
 * - deductions + refundAmount 必须等于台账余额，保证结算等式；
 * - 同一事务内写 DEDUCT / REFUND 流水并把余额归零。
 */
export async function settleDepositOnCheckout(
  tx: Tx,
  params: {
    contractId: string;
    deductions: number;
    refundAmount: number;
    operatorId: string;
    checkoutId: string;
  },
): Promise<{ id: string; deductions: number; refundAmount: number } | null> {
  const { contractId, deductions, refundAmount, operatorId, checkoutId } = params;

  const ledger = await tx.depositLedger.findUnique({ where: { contractId } });
  if (!ledger) {
    throw new Error('缺少押金台账，不能自动按零押金或已缴全额完成退租');
  }
  if (deductions < 0 || refundAmount < 0) {
    throw new Error('押金扣减/退还金额不能为负');
  }

  if (ledger.balance !== deductions + refundAmount) {
    throw new Error(
      `押金台账余额 ${ledger.balance} 分与结算明细（扣减 ${deductions} + 退还 ${refundAmount}）不一致`,
    );
  }

  let balance = ledger.balance;
  if (deductions > 0) {
    balance -= deductions;
    await tx.depositTransaction.create({
      data: {
        ledgerId: ledger.id,
        type: 'DEDUCT',
        amount: -deductions,
        balanceAfter: balance,
        relatedType: 'CHECKOUT',
        relatedId: checkoutId,
        operatorId,
        notes: '退租结算扣减押金',
      },
    });
  }
  if (refundAmount > 0) {
    balance -= refundAmount;
    await tx.depositTransaction.create({
      data: {
        ledgerId: ledger.id,
        type: 'REFUND',
        amount: -refundAmount,
        balanceAfter: balance,
        relatedType: 'CHECKOUT',
        relatedId: checkoutId,
        operatorId,
        notes: '退租结算退还押金',
      },
    });
  }

  await tx.depositLedger.update({
    where: { id: ledger.id },
    data: { balance, status: 'REFUNDED' },
  });

  return { id: ledger.id, deductions, refundAmount };
}
