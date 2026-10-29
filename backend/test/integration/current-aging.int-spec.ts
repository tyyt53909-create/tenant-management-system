import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { prisma, createApp, resetDatabase, seedBase, setupTenancy, http, auth } from './harness.js';
import { BusinessClock } from '../../src/common/business-clock/business-clock.service.js';
let app: INestApplication;
beforeAll(async () => { app = await createApp(); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
beforeEach(async () => { await resetDatabase(); vi.restoreAllMocks(); });
describe('current aging API', () => {
  it('classifies boundaries and fees in a consistent current business day, and enforces access', async () => {
    const base = await seedBase(); const tenancy = await setupTenancy(app, base);
    const clock = app.get(BusinessClock);
    vi.spyOn(clock, 'now').mockReturnValue(new Date('2026-10-29T04:00:00Z'));
    const today = clock.todayUtc();
    const ids: string[] = [];
    for (const [index, days] of [-1,0,1,30,31,60,61,90,91].entries()) {
      const created = await prisma.bill.create({ data: { contractId: tenancy.contractId, billNumber: `AGE-${index}`, billType: index === 8 ? 'UTILITY' : 'RENT', period: `AGE-${index}`, amount: 1000, dueDate: clock.addDays(today, -days), snapshot: {} } });
      ids.push(created.id);
    }
    const other = await prisma.bill.create({data:{contractId:tenancy.contractId,billNumber:'AGE-OTHER',billType:'OTHER',period:'AGE',amount:1000,dueDate:today,snapshot:{}}});
    await prisma.lateFee.create({ data: { billId:other.id,suggestedAmount:200,confirmedAmount:200,overdueDays:1,calculation:{} } });
    await prisma.bill.create({data:{contractId:tenancy.contractId,billNumber:'AGE-CANCEL',billType:'OTHER',period:'AGE',amount:5000,dueDate:today,status:'CANCELLED',snapshot:{}}});
    const unknown = await prisma.bill.create({data:{contractId:tenancy.contractId,billNumber:'AGE-UNKNOWN',billType:'OTHER',period:'AGE',amount:1000,paidAmount:100,status:'PARTIAL',dueDate:today,snapshot:{}}});
    const paid = await prisma.bill.create({data:{contractId:tenancy.contractId,billNumber:'AGE-PAID',billType:'OTHER',period:'AGE',amount:1000,dueDate:today,snapshot:{}}});
    expect((await http(app).post(`/bills/${paid.id}/payments`).set(auth(tenancy.adminToken)).send({amount:1000,paymentMethod:'CASH'})).status).toBe(201);
    const result = await http(app).get('/bills/current-aging').set(auth(tenancy.adminToken));
    expect(result.status).toBe(200);
    expect(result.body.asOfBusinessDate).toBe(clock.formatDate(clock.now()));
    const rent = result.body.groups.find((g: any) => g.billType === 'RENT');
    for (const [index, key] of ['CURRENT','CURRENT','DAYS_1_30','DAYS_1_30','DAYS_31_60','DAYS_31_60','DAYS_61_90','DAYS_61_90'].entries()) expect(rent.buckets[key].billIds).toContain(ids[index]);
    expect(result.body.groups.find((g: any) => g.billType === 'UTILITY').buckets.DAYS_91_PLUS.amount).toBe(1000);
    const otherGroup = result.body.groups.find((g: any) => g.billType === 'OTHER');
    expect(otherGroup.principal).toBe(1000); expect(otherGroup.lateFee).toBe(200);
    expect(otherGroup.unknownPrincipalIds).toContain(unknown.id);
    expect(otherGroup.buckets.CURRENT.billIds).not.toContain(paid.id);
    const empty = await http(app).get('/bills/current-aging?buildingId=missing-building').set(auth(tenancy.adminToken));
    expect(empty.body.totals.principal).toBe(0);
    expect((await http(app).get('/bills/current-aging?billType=BAD').set(auth(tenancy.adminToken))).status).toBe(400);
    expect((await http(app).get('/bills/current-aging?asOf=2020-01-01').set(auth(tenancy.adminToken))).status).toBe(400);
    expect((await http(app).get('/bills/current-aging').set(auth(tenancy.tenantToken))).status).toBe(403);
  });
  it('retries at business midnight and reflects a verified partial payment', async () => {
    const base = await seedBase(); const tenancy = await setupTenancy(app, base);
    const clock = app.get(BusinessClock);
    const b = await prisma.bill.create({ data: { contractId: tenancy.contractId, billNumber:'AGE-PARTIAL', billType:'OTHER', period:'AGE-PARTIAL', amount:1000, dueDate:new Date('2026-10-28T00:00:00Z'), snapshot:{} } });
    const payment = await http(app).post(`/bills/${b.id}/payments`).set(auth(tenancy.adminToken)).send({amount:400,paymentMethod:'CASH'});
    expect(payment.status).toBe(201);
    const before = new Date('2026-10-28T15:59:59Z');
    const after = new Date('2026-10-28T16:00:01Z');
    vi.spyOn(clock, 'now').mockReturnValueOnce(before).mockReturnValue(after);
    const result = await http(app).get('/bills/current-aging?billType=OTHER').set(auth(tenancy.adminToken));
    expect(result.status).toBe(200);
    expect(result.body.asOfBusinessDate).toBe(clock.formatDate(after));
    const group = result.body.groups[0];
    expect(group.principal).toBe(600);
    expect(group.buckets.DAYS_1_30.billIds).toContain(b.id);
    expect(group.unknownPrincipalCount).toBe(0);
  });

  it('keeps a partially settled confirmed late fee separate from paid principal', async () => {
    const base = await seedBase(); const tenancy = await setupTenancy(app, base);
    const b = await prisma.bill.create({data:{contractId:tenancy.contractId,billNumber:'AGE-FEE',billType:'OTHER',period:'AGE-FEE',amount:1000,dueDate:new Date('2026-01-01'),snapshot:{}}});
    await prisma.lateFee.create({data:{billId:b.id,suggestedAmount:200,confirmedAmount:200,overdueDays:5,calculation:{}}});
    const payment = await http(app).post(`/bills/${b.id}/payments`).set(auth(tenancy.adminToken)).send({amount:1100,paymentMethod:'CASH'});
    expect(payment.status).toBe(201);
    const result = await http(app).get('/bills/current-aging?billType=OTHER').set(auth(tenancy.adminToken));
    expect(result.status).toBe(200);
    expect(result.body.groups[0].principal).toBe(0);
    expect(result.body.groups[0].lateFee).toBe(100);
    expect(result.body.groups[0].unknownLateFeeCount).toBe(0);
  });

});
