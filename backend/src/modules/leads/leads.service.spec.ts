import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { LeadsService } from './leads.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('LeadsService', () => {
  let service: LeadsService;
  let prisma: any;

  beforeEach(async () => {
    const prismaMock: any = {
      lead: {
        findMany: vi.fn(),
        count: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [LeadsService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = module.get<LeadsService>(LeadsService);
    prisma = prismaMock;
  });

  describe('findAll', () => {
    it('按状态与关键字多条件分页筛选', async () => {
      prisma.lead.findMany.mockResolvedValue([{ id: 'l1', name: '张三' }]);
      prisma.lead.count.mockResolvedValue(1);

      const res = await service.findAll({
        page: 1,
        limit: 10,
        status: 'NEW',
        keyword: '张',
      });

      expect(res.data).toHaveLength(1);
      expect(res.meta.total).toBe(1);
      const where = prisma.lead.findMany.mock.calls[0][0].where;
      expect(where.status).toBe('NEW');
      expect(where.OR).toBeDefined();
    });
  });

  describe('findOne', () => {
    it('线索存在时返回详情', async () => {
      prisma.lead.findUnique.mockResolvedValue({ id: 'l1', name: '李四' });
      const res = await service.findOne('l1');
      expect(res.id).toBe('l1');
    });

    it('线索不存在时抛出 NotFoundException', async () => {
      prisma.lead.findUnique.mockResolvedValue(null);
      await expect(service.findOne('l-none')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('更新跟进人与状态', async () => {
      prisma.lead.findUnique.mockResolvedValue({ id: 'l1' });
      prisma.lead.update.mockResolvedValue({ id: 'l1', status: 'FOLLOWING' });

      const res = await service.update(
        'l1',
        { status: 'FOLLOWING', notes: '已联系' },
        'admin-1',
      );

      expect(res.status).toBe('FOLLOWING');
      expect(prisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'l1' },
          data: expect.objectContaining({
            status: 'FOLLOWING',
            notes: '已联系',
            followUpBy: 'admin-1',
          }),
        }),
      );
    });
  });

  describe('remove', () => {
    it('成功删除线索', async () => {
      prisma.lead.findUnique.mockResolvedValue({ id: 'l1' });
      prisma.lead.delete.mockResolvedValue({ id: 'l1' });

      const res = await service.remove('l1');
      expect(res.success).toBe(true);
      expect(prisma.lead.delete).toHaveBeenCalledWith({ where: { id: 'l1' } });
    });
  });
});
