import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { prisma, createApp, resetDatabase, seedBase, setupTenancy, http, auth } from './harness.js';
let app: INestApplication;
beforeAll(async () => { app = await createApp(); });
afterAll(async () => { await app?.close(); await prisma.$disconnect(); });
beforeEach(async () => { await resetDatabase(); });
describe('当前余额核对', () => {
  it('展示账面、历史限制、未知归属与权限，不把草稿或无账户视为缺失', async () => {
    const base = await seedBase(); const t = await setupTenancy(app, base);
    const account = await prisma.prepayAccount.create({ data: { tenantId: t.tenantId, roomId: t.roomId, balanceCache: -100 } });
    await prisma.prepayTransaction.create({ data: { accountId: account.id, type: 'ADJUSTMENT', amount: -100, balanceAfter: -100, description: '合成', operatorId: base.adminId } });
    const ledger = await prisma.depositLedger.create({ data: { contractId: t.contractId, tenantId: t.tenantId, roomId: t.roomId, amount: 10000, balance: 10000 } });
    await prisma.depositTransaction.create({ data: { ledgerId: ledger.id, type: 'COLLECT', amount: 10000, balanceAfter: 10000, operatorId: base.adminId } });
    const get = (buildingId: string, token = t.adminToken) => http(app).get('/statistics/current-balances').query({ buildingId }).set(auth(token));
    const result = await get(base.buildingId);
    expect(result.status).toBe(200);
    expect(result.body.deposit).toMatchObject({ bookSubtotal: 10000, unknownCount: 1, verifiedTotal: null });
    expect(result.body.deposit.items[0].reasons).toContain('历史流水完整性无法证明');
    expect(result.body.prepay).toMatchObject({ bookSubtotal: -100, unknownCount: 1, verifiedTotal: null });
    expect(result.body.prepay.items[0].reasons).toContain('账面余额为负数');
    expect((await get(base.buildingId, t.tenantToken)).status).toBe(403);
    const other = await prisma.building.create({ data: { name: '空楼', floors: 1 } });
    expect((await get(other.id)).body.deposit).toMatchObject({ bookSubtotal: 0, unknownCount: 0 });
  });
  it('押金转移只反映两份当前余额，缺台账按收款证据标记', async () => {
    const base = await seedBase(); const t = await setupTenancy(app, base);
    const source = await prisma.depositLedger.create({ data: { contractId: t.contractId, tenantId: t.tenantId, roomId: t.roomId, amount: 10000, balance: 0 } });
    await prisma.depositTransaction.createMany({ data: [
      { ledgerId: source.id, type: 'COLLECT', amount: 10000, balanceAfter: 10000, operatorId: base.adminId, createdAt: new Date('2026-01-01') },
      { ledgerId: source.id, type: 'TRANSFER', amount: -10000, balanceAfter: 0, operatorId: base.adminId, createdAt: new Date('2026-01-02') },
    ] });
    const original = await prisma.contract.findUniqueOrThrow({ where: { id: t.contractId } });
    const next = await prisma.contract.create({ data: { buildingId: original.buildingId, roomId: original.roomId, tenantId: original.tenantId, contractNumber: 'SYNTHETIC-RENEW', rentAmount: original.rentAmount, depositAmount: original.depositAmount, paymentCycle: original.paymentCycle, paymentDay: original.paymentDay, startDate: original.startDate, endDate: original.endDate, lateFeeRule: original.lateFeeRule as object } });
    const target = await prisma.depositLedger.create({ data: { contractId: next.id, tenantId: t.tenantId, roomId: t.roomId, amount: 10000, balance: 10000 } });
    await prisma.depositTransaction.create({ data: { ledgerId: target.id, type: 'TRANSFER', amount: 10000, balanceAfter: 10000, operatorId: base.adminId } });
    const get = () => http(app).get('/statistics/current-balances').query({ buildingId: base.buildingId }).set(auth(t.adminToken));
    expect((await get()).body.deposit).toMatchObject({ bookSubtotal: 10000, unknownCount: 2, verifiedTotal: null });
    const missingContract = await prisma.contract.create({ data: { buildingId: original.buildingId, roomId: original.roomId, tenantId: original.tenantId, contractNumber: 'SYNTHETIC-MISSING', rentAmount: original.rentAmount, depositAmount: original.depositAmount, paymentCycle: original.paymentCycle, paymentDay: original.paymentDay, startDate: original.startDate, endDate: original.endDate, lateFeeRule: original.lateFeeRule as object } });
    const missingBill = await prisma.bill.create({ data: { contractId: missingContract.id, billNumber: 'SYNTHETIC-MISSING', billType: 'DEPOSIT', period: '2026-01', amount: 10000, snapshot: {}, dueDate: new Date('2026-01-10') } });
    await prisma.paymentRecord.create({ data: { billId: missingBill.id, amount: 1000, paymentMethod: 'CASH', paidAt: new Date('2026-01-05'), confirmedBy: base.adminId } });
    const result = (await get()).body.deposit;
    expect(result.bookSubtotal).toBe(10000);
    expect(result.items.find((item: { contractId: string }) => item.contractId === missingContract.id)).toMatchObject({ balance: null, arithmetic: 'unknown', reasons: ['押金账单已有收款但缺少台账'] });
  });
  it('流水数量超限明确拒绝', async () => {
    const base = await seedBase(); const t = await setupTenancy(app, base);
    const account = await prisma.prepayAccount.create({ data: { tenantId: t.tenantId, roomId: t.roomId } });
    await prisma.prepayTransaction.createMany({ data: Array.from({ length: 5001 }, () => ({ accountId: account.id, type: 'ADJUSTMENT' as const, amount: 1, balanceAfter: 1, description: '合成', operatorId: base.adminId })) });
    const result = await http(app).get('/statistics/current-balances').query({ buildingId: base.buildingId }).set(auth(t.adminToken));
    expect(result.status).toBe(400);
  });
});
