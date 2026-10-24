import { describe, expect, it, vi } from 'vitest';
import { applyDepositCollection, reverseDepositCollection } from './deposit-ledger.util.js';

function txMock() {
  const tx = {
    contract: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'c1',
        tenantId: 't1',
        roomId: 'r1',
        depositAmount: 200000,
      }),
    },
    depositLedger: {
      upsert: vi.fn().mockResolvedValue({ id: 'l1', amount: 200000, balance: 0 }),
      findUnique: vi.fn(),
      update: vi.fn().mockImplementation(({ data }: any) => ({ id: 'l1', amount: 200000, ...data })),
    },
    depositTransaction: { create: vi.fn().mockResolvedValue({}) },
  };
  return tx;
}

describe('押金台账写入', () => {
  it('非 DEPOSIT 账单直接忽略', async () => {
    const tx = txMock();
    const result = await applyDepositCollection(tx as never, {
      bill: { id: 'b1', contractId: 'c1', billType: 'RENT' },
      amount: 100,
      operatorId: 'op',
    });
    expect(result).toBeNull();
    expect(tx.depositLedger.upsert).not.toHaveBeenCalled();
  });

  it('押金收款累加余额并写 COLLECT 流水', async () => {
    const tx = txMock();
    tx.depositLedger.upsert.mockResolvedValue({ id: 'l1', amount: 200000, balance: 50000 });
    tx.depositLedger.update.mockResolvedValue({ id: 'l1', amount: 200000, balance: 100000 });

    const result = await applyDepositCollection(tx as never, {
      bill: { id: 'b1', contractId: 'c1', billType: 'DEPOSIT' },
      amount: 50000,
      operatorId: 'op',
    });

    expect(result).toEqual({ id: 'l1', balance: 100000 });
    expect(tx.depositLedger.update).toHaveBeenCalledWith({
      where: { id: 'l1' },
      data: { balance: 100000, status: 'PARTIAL' },
    });
    expect(tx.depositTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'COLLECT',
        amount: 50000,
        balanceAfter: 100000,
        relatedId: 'b1',
      }),
    });
  });

  it('收满后状态为 HELD', async () => {
    const tx = txMock();
    tx.depositLedger.upsert.mockResolvedValue({ id: 'l1', amount: 200000, balance: 150000 });
    tx.depositLedger.update.mockResolvedValue({ id: 'l1', amount: 200000, balance: 200000 });

    await applyDepositCollection(tx as never, {
      bill: { id: 'b1', contractId: 'c1', billType: 'DEPOSIT' },
      amount: 50000,
      operatorId: 'op',
    });

    expect(tx.depositLedger.update).toHaveBeenCalledWith({
      where: { id: 'l1' },
      data: { balance: 200000, status: 'HELD' },
    });
  });

  it('冲正扣减余额且不为负', async () => {
    const tx = txMock();
    tx.depositLedger.findUnique.mockResolvedValue({ id: 'l1', amount: 200000, balance: 30000 });
    tx.depositLedger.update.mockResolvedValue({ id: 'l1', amount: 200000, balance: 0 });

    const result = await reverseDepositCollection(tx as never, {
      bill: { id: 'b1', contractId: 'c1', billType: 'DEPOSIT' },
      amount: 50000,
      operatorId: 'op',
    });

    expect(result).toEqual({ id: 'l1', balance: 0 });
    expect(tx.depositLedger.update).toHaveBeenCalledWith({
      where: { id: 'l1' },
      data: { balance: 0, status: 'PARTIAL' },
    });
    expect(tx.depositTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'REVERSAL', amount: -50000 }),
    });
  });
});
