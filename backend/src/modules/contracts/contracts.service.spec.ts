import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
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
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ContractsService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = module.get<ContractsService>(ContractsService);
    prisma = prismaMock;
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
});
