import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { BillsService } from './bills/bills.service.js';
import { ContractsService } from './contracts/contracts.service.js';
import { MaintenanceService } from './maintenance/maintenance.service.js';
import { PrepayService } from './prepay/prepay.service.js';
import { PrismaService } from './prisma/prisma.service.js';

/**
 * 安全回归（T158）：租客范围查询在 tenantId 缺失时
 * 必须返回空结果 / 404，绝不能退化为「不过滤」。
 *
 * Prisma 语义陷阱：`where: { tenantId: undefined }` 等价于没有该条件。
 */
const prismaMock: any = {
  bill: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
  contract: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
  maintenanceRequest: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
  prepayAccount: { findFirst: vi.fn(), findMany: vi.fn() },
  prepayTransaction: { findMany: vi.fn(), count: vi.fn() },
  room: { findUnique: vi.fn() },
};

describe('租客范围查询：tenantId 缺失必须 fail-closed（T158 安全回归）', () => {
  let bills: BillsService;
  let contracts: ContractsService;
  let maintenance: MaintenanceService;
  let prepay: PrepayService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillsService,
        ContractsService,
        MaintenanceService,
        PrepayService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    bills = module.get(BillsService);
    contracts = module.get(ContractsService);
    maintenance = module.get(MaintenanceService);
    prepay = module.get(PrepayService);
  });

  const undefinedIds: any[] = [undefined, '', null];

  it('bills.findByTenant：tenantId 缺失 → 空列表，且不查库', async () => {
    for (const id of undefinedIds) {
      const res = await bills.findByTenant(id as any, { page: 1, limit: 20 } as any);
      expect(res.data).toEqual([]);
      expect(res.meta.total).toBe(0);
    }
    expect(prismaMock.bill.findMany).not.toHaveBeenCalled();
  });

  it('bills.findOneForTenant：tenantId 缺失 → 404，且不查库', async () => {
    for (const id of undefinedIds) {
      await expect(bills.findOneForTenant('bill-1', id as any)).rejects.toThrow(NotFoundException);
    }
    expect(prismaMock.bill.findUnique).not.toHaveBeenCalled();
  });

  it('contracts.findByTenant：tenantId 缺失 → 空列表，且不查库', async () => {
    for (const id of undefinedIds) {
      const res = await contracts.findByTenant(id as any, { page: 1, limit: 20 } as any);
      expect(res.data).toEqual([]);
    }
    expect(prismaMock.contract.findMany).not.toHaveBeenCalled();
  });

  it('contracts.findOneForTenant：tenantId 缺失 → 404', async () => {
    for (const id of undefinedIds) {
      await expect(contracts.findOneForTenant('c-1', id as any)).rejects.toThrow(NotFoundException);
    }
    expect(prismaMock.contract.findUnique).not.toHaveBeenCalled();
  });

  it('maintenance.findByTenant：tenantId 缺失 → 空列表，且不查库', async () => {
    for (const id of undefinedIds) {
      const res = await maintenance.findByTenant(id as any, { page: 1, limit: 20 } as any);
      expect(res.data).toEqual([]);
    }
    expect(prismaMock.maintenanceRequest.findMany).not.toHaveBeenCalled();
  });

  it('prepay.findByTenant：tenantId 缺失 → 404，且不查库', async () => {
    for (const id of undefinedIds) {
      await expect(prepay.findByTenant(id as any)).rejects.toThrow(NotFoundException);
    }
    expect(prismaMock.prepayAccount.findFirst).not.toHaveBeenCalled();
  });

  it('prepay.findTransactionsByTenant：tenantId 缺失 → 空列表（原为越权/500）', async () => {
    const res = await prepay.findTransactionsByTenant(undefined as any, { page: 1, limit: 20 });
    expect(res.data).toEqual([]);
    expect(prismaMock.prepayAccount.findFirst).not.toHaveBeenCalled();
  });
});
