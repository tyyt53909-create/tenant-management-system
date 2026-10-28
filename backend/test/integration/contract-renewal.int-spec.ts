import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { auth, createApp, http, login, prisma, resetDatabase, seedBase } from './harness.js';
import { JwtAuthService } from '../../src/modules/auth/jwt.service.js';
import { SchedulerDailyJobsService } from '../../src/modules/scheduler/scheduler-daily-jobs.service.js';
import { startOfTodayUtc, MS_PER_DAY } from '../../src/modules/scheduler/scheduler.util.js';

let app: INestApplication;

beforeAll(async () => {
  app = await createApp();
}, 30_000);

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
});

describe('合同到期提醒、续约意向与续约报价集成测试（T301 / LSE-04 / ISS-20）', () => {
  it('到期梯次提醒、Holdover 滞留检测、续约意向登记与报价接受联动续约全闭环', async () => {
    const base = await seedBase();
    const adminToken = await login(app, base.adminEmail, base.adminPassword);

    const room = await prisma.room.create({
      data: {
        buildingId: base.buildingId,
        roomNumber: '501',
        floor: 5,
        roomType: 'ONE_BED',
        area: 45,
        status: 'OCCUPIED',
      },
    });

    const tenantUser = await prisma.user.create({
      data: {
        role: 'TENANT',
        phone: '13988887777',
        tenant: {
          create: {
            name: '续约集成测试租客',
            phone: '13988887777',
          },
        },
      },
      include: { tenant: true },
    });
    const tenantId = tenantUser.tenant!.id;

    const jwtService = app.get(JwtAuthService);
    const tenantToken = (
      await jwtService.generateTokens({ sub: tenantUser.id, role: 'TENANT' })
    ).accessToken;

    const today = startOfTodayUtc();
    // 设置 30 天后到期（业务日 UTC 零点）
    const endDate30 = new Date(today.getTime() + 30 * MS_PER_DAY);
    const startDate = new Date(today.getTime() - 365 * MS_PER_DAY);

    const activeContract = await prisma.contract.create({
      data: {
        buildingId: base.buildingId,
        roomId: room.id,
        tenantId,
        contractNumber: `C_RENEW_${Date.now()}`,
        rentAmount: 320000,
        depositAmount: 320000,
        paymentCycle: 'MONTHLY',
        paymentDay: 5,
        startDate,
        endDate: endDate30,
        status: 'ACTIVE',
        lateFeeRule: {},
      },
    });

    // ----------------------------------------------------
    // 1. 到期梯次扫描与提醒（30天 / 15天 / 7天）
    // ----------------------------------------------------
    const schedulerDaily = app.get(SchedulerDailyJobsService);
    const sentCount = await schedulerDaily.sendExpiringContractReminders();
    expect(sentCount).toBe(1);

    const notification = await prisma.notification.findFirst({
      where: { userId: tenantUser.id },
    });
    expect(notification).not.toBeNull();
    expect(notification!.title).toBe('合同即将到期提醒');
    expect(notification!.body).toContain('30 天后');
    expect(notification!.dedupKey).toBe(`CONTRACT_EXPIRING:${tenantUser.id}:${activeContract.id}:expiring-d30`);

    // 再次扫描验证幂等去重
    const secondScan = await schedulerDaily.sendExpiringContractReminders();
    expect(secondScan).toBe(0);

    // ----------------------------------------------------
    // 2. 租客填报续约意向（RenewalIntent）
    // ----------------------------------------------------
    const intentRes = await http(app)
      .post(`/contracts/${activeContract.id}/renewal-intent`)
      .set(auth(tenantToken))
      .send({
        intent: 'RENEW',
        expectedMonths: 12,
        expectedRent: 330000,
        notes: '希望原价续租1年，请管家审核',
      });
    expect(intentRes.status).toBe(201);
    expect(intentRes.body.intent).toBe('RENEW');
    expect(intentRes.body.expectedMonths).toBe(12);

    // 租客查询本人的续约意向
    const myIntentRes = await http(app)
      .get(`/contracts/${activeContract.id}/renewal-intent`)
      .set(auth(tenantToken));
    expect(myIntentRes.status).toBe(200);
    expect(myIntentRes.body.intent).toBe('RENEW');

    // 管理端查询全部续约意向
    const adminIntentsRes = await http(app)
      .get('/contracts/renewal-intents')
      .set(auth(adminToken));
    expect(adminIntentsRes.status).toBe(200);
    expect(adminIntentsRes.body.data.length).toBeGreaterThan(0);
    expect(adminIntentsRes.body.data[0].contractId).toBe(activeContract.id);

    // ----------------------------------------------------
    // 3. 管理端发起定制续约报价（RenewalOffer）
    // ----------------------------------------------------
    const offerRes = await http(app)
      .post(`/contracts/${activeContract.id}/renewal-offers`)
      .set(auth(adminToken))
      .send({
        offeredRent: 330000,
        offeredDeposit: 330000,
        startDate: '2026-12-01',
        endDate: '2027-11-30',
        discountNotes: '老带新续约立减200元/月',
      });
    expect(offerRes.status).toBe(201);
    const offerId = offerRes.body.id;
    expect(offerRes.body.status).toBe('PENDING');
    expect(offerRes.body.offeredRent).toBe(330000);

    // 租客端查询收到的报价
    const tenantOffersRes = await http(app)
      .get('/contracts/renewal-offers/my')
      .set(auth(tenantToken));
    expect(tenantOffersRes.status).toBe(200);
    expect(tenantOffersRes.body.data.some((o: any) => o.id === offerId)).toBe(true);

    // ----------------------------------------------------
    // 4. 租客接受报价并自动联动创建续租合同草稿
    // ----------------------------------------------------
    const acceptRes = await http(app)
      .post(`/contracts/renewal-offers/${offerId}/respond`)
      .set(auth(tenantToken))
      .send({ agree: true });
    expect(acceptRes.status).toBe(201);
    expect(acceptRes.body.status).toBe('ACCEPTED');
    expect(acceptRes.body.renewedContractId).toBeTruthy();

    const renewedContract = await prisma.contract.findUnique({
      where: { id: acceptRes.body.renewedContractId },
    });
    expect(renewedContract).not.toBeNull();
    expect(renewedContract!.status).toBe('DRAFT');
    expect(renewedContract!.renewedFromId).toBe(activeContract.id);
    expect(renewedContract!.rentAmount).toBe(330000);
    expect(renewedContract!.depositAmount).toBe(330000);

    // ----------------------------------------------------
    // 5. 到期滞留（Holdover）合同检测（ISS-20）
    // ----------------------------------------------------
    // 构造一份已到期（EXPIRED）但房间仍为 OCCUPIED、既未退租也未生效新合同的历史合同
    const holdoverRoom = await prisma.room.create({
      data: {
        buildingId: base.buildingId,
        roomNumber: '502',
        floor: 5,
        roomType: 'ONE_BED',
        area: 40,
        status: 'OCCUPIED',
      },
    });

    const pastEndDate = new Date(today.getTime() - 10 * MS_PER_DAY);
    const expiredContract = await prisma.contract.create({
      data: {
        buildingId: base.buildingId,
        roomId: holdoverRoom.id,
        tenantId,
        contractNumber: `C_HOLDOVER_${Date.now()}`,
        rentAmount: 280000,
        depositAmount: 280000,
        paymentCycle: 'MONTHLY',
        paymentDay: 5,
        startDate: new Date(today.getTime() - 375 * MS_PER_DAY),
        endDate: pastEndDate,
        status: 'EXPIRED',
        lateFeeRule: {},
      },
    });

    const holdoverRes = await http(app)
      .get('/contracts/holdover')
      .set(auth(adminToken));
    expect(holdoverRes.status).toBe(200);
    expect(holdoverRes.body.some((c: any) => c.id === expiredContract.id)).toBe(true);
    const holdoverTarget = holdoverRes.body.find((c: any) => c.id === expiredContract.id);
    expect(holdoverTarget.daysOverdue).toBeGreaterThanOrEqual(9);
  });
});
