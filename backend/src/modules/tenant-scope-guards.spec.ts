import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { BillsService } from './bills/bills.service.js';
import { CheckoutService } from './checkout/checkout.service.js';
import { ContractsService } from './contracts/contracts.service.js';
import { MaintenanceService } from './maintenance/maintenance.service.js';
import { NotificationsService } from './notifications/notifications.service.js';
import { PrepayService } from './prepay/prepay.service.js';
import { SettingsService } from './settings/settings.service.js';
import { PrismaService } from './prisma/prisma.service.js';

/**
 * 租客范围查询在 tenantId / userId 缺失时必须 403。
 * Prisma 会把 `{ tenantId: undefined }` 当成没有这个条件。
 */
const prismaMock: any = {
  bill: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
  contract: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
  maintenanceRequest: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
  prepayAccount: { findFirst: vi.fn(), findMany: vi.fn() },
  prepayTransaction: { findMany: vi.fn(), count: vi.fn() },
  checkoutRecord: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
  notification: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  room: { findUnique: vi.fn() },
};

describe('租客范围查询：身份缺失必须 403 且不查库', () => {
  let bills: BillsService;
  let contracts: ContractsService;
  let maintenance: MaintenanceService;
  let prepay: PrepayService;
  let checkout: CheckoutService;
  let notifications: NotificationsService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillsService,
        ContractsService,
        MaintenanceService,
        PrepayService,
        CheckoutService,
        NotificationsService,
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: SettingsService,
          useValue: {
            getValue: vi.fn().mockImplementation(async (key: string) =>
              key === 'billing.defaultLateFeeRule' ? {} : 10000,
            ),
          },
        },
      ],
    }).compile();

    bills = module.get(BillsService);
    contracts = module.get(ContractsService);
    maintenance = module.get(MaintenanceService);
    prepay = module.get(PrepayService);
    checkout = module.get(CheckoutService);
    notifications = module.get(NotificationsService);
  });

  const missingIds: Array<string | null | undefined> = [undefined, '', null, '   '];

  async function expectForbidden(run: () => Promise<unknown>) {
    await expect(run()).rejects.toThrow(ForbiddenException);
  }

  it('bills：tenantId 缺失时列表和详情都 403，且不查库', async () => {
    for (const id of missingIds) {
      await expectForbidden(() => bills.findByTenant(id as never, { page: 1, limit: 20 } as never));
      await expectForbidden(() => bills.findOneForTenant('bill-1', id as never));
    }
    expect(prismaMock.bill.findMany).not.toHaveBeenCalled();
    expect(prismaMock.bill.findUnique).not.toHaveBeenCalled();
  });

  it('contracts：tenantId 缺失时 403，且不查库', async () => {
    for (const id of missingIds) {
      await expectForbidden(() => contracts.findByTenant(id as never, { page: 1, limit: 20 } as never));
      await expectForbidden(() => contracts.findOneForTenant('c-1', id as never));
    }
    expect(prismaMock.contract.findMany).not.toHaveBeenCalled();
    expect(prismaMock.contract.findUnique).not.toHaveBeenCalled();
  });

  it('maintenance：tenantId 缺失时 403，且不查库', async () => {
    for (const id of missingIds) {
      await expectForbidden(() => maintenance.findByTenant(id as never, { page: 1, limit: 20 } as never));
      await expectForbidden(() => maintenance.findOneForTenant('m-1', id as never));
    }
    expect(prismaMock.maintenanceRequest.findMany).not.toHaveBeenCalled();
    expect(prismaMock.maintenanceRequest.findUnique).not.toHaveBeenCalled();
  });

  it('prepay：tenantId 缺失时 403，且不查库', async () => {
    for (const id of missingIds) {
      await expectForbidden(() => prepay.findByTenant(id as never));
      await expectForbidden(() => prepay.findTransactionsByTenant(id as never, { page: 1, limit: 20 }));
    }
    expect(prismaMock.prepayAccount.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.prepayTransaction.findMany).not.toHaveBeenCalled();
  });

  it('checkout：tenantId 缺失时 403，且不查库', async () => {
    for (const id of missingIds) {
      await expectForbidden(() => checkout.findByTenant(id as never, { page: 1, limit: 20 } as never));
      await expectForbidden(() => checkout.findOneForTenant('chk-1', id as never));
    }
    expect(prismaMock.checkoutRecord.findMany).not.toHaveBeenCalled();
    expect(prismaMock.checkoutRecord.findUnique).not.toHaveBeenCalled();
  });

  it('notifications：userId 缺失时 403，且不查库', async () => {
    for (const id of missingIds) {
      await expectForbidden(() => notifications.findAll(id as never, {} as never));
      await expectForbidden(() => notifications.unreadCount(id as never));
      await expectForbidden(() => notifications.markAllRead(id as never));
    }
    expect(prismaMock.notification.findMany).not.toHaveBeenCalled();
    expect(prismaMock.notification.count).not.toHaveBeenCalled();
    expect(prismaMock.notification.updateMany).not.toHaveBeenCalled();
  });
});
