import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ContractsService } from './contracts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('ContractsService（租客隔离，T148）', () => {
  let service: ContractsService;
  let prisma: any;

  beforeEach(async () => {
    const prismaMock: any = {
      contract: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ContractsService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = module.get<ContractsService>(ContractsService);
    prisma = prismaMock;
  });

  it('管理合同详情包含房源封面与续签关系，不把扫描件当作房源照片',async()=>{
    prisma.contract.findUnique.mockResolvedValue({id:'c1'});
    await service.findOne('c1');
    expect(prisma.contract.findUnique).toHaveBeenCalledWith(expect.objectContaining({include:expect.objectContaining({
      room:{include:{photos:{select:{id:true,fileUrl:true},orderBy:[{sortOrder:'asc'},{createdAt:'asc'}],take:20}}},
      renewedTo:{select:{id:true,contractNumber:true}},
    })}));
  });

  describe('findByTenant', () => {
    it('服务端固定按 tenantId 过滤', async () => {
      prisma.contract.findMany.mockResolvedValue([]);
      prisma.contract.count.mockResolvedValue(0);

      await service.findByTenant('tenant-1', { page: 1, limit: 20 } as any);

      expect(prisma.contract.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 'tenant-1' } }),
      );
    });

    it('叠加 status 过滤并分页', async () => {
      prisma.contract.findMany.mockResolvedValue([]);
      prisma.contract.count.mockResolvedValue(0);

      const result = await service.findByTenant('tenant-1', {
        page: 3,
        limit: 5,
        status: 'ACTIVE',
      } as any);

      expect(result.meta).toEqual({ page: 3, limit: 5, total: 0, totalPages: 0 });
      expect(prisma.contract.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 'tenant-1', status: 'ACTIVE' },
          skip: 10,
          take: 5,
        }),
      );
    });
  });

  describe('findOneForTenant', () => {
    it('自己的合同 → 返回', async () => {
      prisma.contract.findUnique.mockResolvedValue({ id: 'contract-1', tenantId: 'tenant-1' });

      const result = await service.findOneForTenant('contract-1', 'tenant-1');

      expect(result.id).toBe('contract-1');
    });

    it('他人合同 → 404（不暴露存在性）', async () => {
      prisma.contract.findUnique.mockResolvedValue({ id: 'contract-2', tenantId: 'tenant-2' });

      await expect(service.findOneForTenant('contract-2', 'tenant-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('合同不存在 → 404', async () => {
      prisma.contract.findUnique.mockResolvedValue(null);

      await expect(service.findOneForTenant('contract-404', 'tenant-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('renew（T154 合同续签）', () => {
    const original = {
      id: 'contract-old',
      buildingId: 'b-1',
      roomId: 'room-1',
      tenantId: 'tenant-1',
      contractNumber: 'C-OLD',
      rentAmount: 300000,
      depositAmount: 600000,
      paymentCycle: 'MONTHLY',
      paymentDay: 5,
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
      lateFeeRule: { graceDays: 3 },
      status: 'ACTIVE',
      renewedTo: null,
    };

    it('复制原合同生成 DRAFT 新合同并关联 renewedFromId', async () => {
      prisma.contract.findUnique.mockResolvedValue(original);
      prisma.contract.create.mockImplementation(async ({ data }: any) => ({ id: 'contract-new', ...data }));

      const result = await service.renew('contract-old', { endDate: '2027-12-31' } as any);

      const call = prisma.contract.create.mock.calls[0][0].data;
      expect(call.renewedFromId).toBe('contract-old');
      expect(call.status).toBe('DRAFT');
      // 未提供的字段从原合同复制
      expect(call.rentAmount).toBe(300000);
      expect(call.depositAmount).toBe(600000);
      expect(call.paymentCycle).toBe('MONTHLY');
      expect(call.paymentDay).toBe(5);
      expect(call.roomId).toBe('room-1');
      expect(call.tenantId).toBe('tenant-1');
      // 起始日默认为原到期日次日
      expect(call.startDate.toISOString().slice(0, 10)).toBe('2027-01-01');
      expect(result.id).toBe('contract-new');
    });

    it('允许调整租金与押金', async () => {
      prisma.contract.findUnique.mockResolvedValue(original);
      prisma.contract.create.mockImplementation(async ({ data }: any) => ({ id: 'contract-new', ...data }));

      await service.renew('contract-old', {
        endDate: '2027-12-31',
        rentAmount: 350000,
        depositAmount: 700000,
      } as any);

      const call = prisma.contract.create.mock.calls[0][0].data;
      expect(call.rentAmount).toBe(350000);
      expect(call.depositAmount).toBe(700000);
    });

    it('重复续签 → 409', async () => {
      prisma.contract.findUnique.mockResolvedValue({ ...original, renewedTo: { id: 'x' } });

      await expect(service.renew('contract-old', { endDate: '2027-12-31' } as any)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.contract.create).not.toHaveBeenCalled();
    });

    it('已续签状态 → 409', async () => {
      prisma.contract.findUnique.mockResolvedValue({ ...original, status: 'RENEWED' });

      await expect(service.renew('contract-old', { endDate: '2027-12-31' } as any)).rejects.toThrow(
        ConflictException,
      );
    });

    it('已终止合同 → 400', async () => {
      prisma.contract.findUnique.mockResolvedValue({ ...original, status: 'TERMINATED' });

      await expect(service.renew('contract-old', { endDate: '2027-12-31' } as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('到期日早于起始日 → 400', async () => {
      prisma.contract.findUnique.mockResolvedValue(original);

      await expect(
        service.renew('contract-old', { startDate: '2027-06-01', endDate: '2027-01-01' } as any),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.contract.create).not.toHaveBeenCalled();
    });

    it('合同不存在 → 404', async () => {
      prisma.contract.findUnique.mockResolvedValue(null);

      await expect(service.renew('nope', { endDate: '2027-12-31' } as any)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
