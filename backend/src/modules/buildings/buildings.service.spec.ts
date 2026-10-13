import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { BuildingsService } from './buildings.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** 楼栋 CRUD 覆盖（T157）：此前语句覆盖率仅 8.3% */
describe('BuildingsService（T157）', () => {
  let service: BuildingsService;
  let prisma: any;

  beforeEach(async () => {
    const prismaMock: any = {
      building: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [BuildingsService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = module.get<BuildingsService>(BuildingsService);
    prisma = prismaMock;
  });

  describe('create', () => {
    it('原样落库', async () => {
      prisma.building.create.mockImplementation(async ({ data }: any) => ({ id: 'b-1', ...data }));

      const res = await service.create({ name: 'A栋', floors: 6 } as any);

      expect(prisma.building.create).toHaveBeenCalledWith({ data: { name: 'A栋', floors: 6 } });
      expect(res.id).toBe('b-1');
    });
  });

  describe('findAll', () => {
    it('不传 isActive 时不过滤', async () => {
      prisma.building.findMany.mockResolvedValue([]);
      prisma.building.count.mockResolvedValue(0);

      const res = await service.findAll({ page: 1, limit: 20 } as any);

      expect(prisma.building.findMany.mock.calls[0][0].where).toEqual({});
      expect(res.meta).toEqual({ page: 1, limit: 20, total: 0, totalPages: 0 });
    });

    it('isActive=false 时按布尔值过滤（注意不能用 if(isActive) 判空）', async () => {
      prisma.building.findMany.mockResolvedValue([]);
      prisma.building.count.mockResolvedValue(0);

      await service.findAll({ page: 1, limit: 20, isActive: false } as any);

      expect(prisma.building.findMany.mock.calls[0][0].where).toEqual({ isActive: false });
    });

    it('isActive=true 时生效并分页', async () => {
      prisma.building.findMany.mockResolvedValue([]);
      prisma.building.count.mockResolvedValue(0);

      const res = await service.findAll({ page: 3, limit: 5, isActive: true } as any);

      const args = prisma.building.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ isActive: true });
      expect(args.skip).toBe(10);
      expect(args.take).toBe(5);
      expect(res.meta.totalPages).toBe(0);
    });
  });

  describe('findOne', () => {
    it('返回含房间数与公共区域数', async () => {
      prisma.building.findUnique.mockResolvedValue({ id: 'b-1', _count: { rooms: 10, publicAreas: 2 } });

      const res = await service.findOne('b-1');

      expect(res._count.rooms).toBe(10);
      expect(prisma.building.findUnique.mock.calls[0][0].include._count).toBeDefined();
    });

    it('不存在 → 404', async () => {
      prisma.building.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('存在 → 更新', async () => {
      prisma.building.findUnique.mockResolvedValue({ id: 'b-1' });
      prisma.building.update.mockResolvedValue({ id: 'b-1', name: '新名' });

      const res = await service.update('b-1', { name: '新名' } as any);

      expect(prisma.building.update).toHaveBeenCalledWith({
        where: { id: 'b-1' },
        data: { name: '新名' },
      });
      expect(res.name).toBe('新名');
    });

    it('不存在 → 404 且不更新', async () => {
      prisma.building.findUnique.mockResolvedValue(null);

      await expect(service.update('nope', { name: 'x' } as any)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.building.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('存在 → 删除并返回提示', async () => {
      prisma.building.findUnique.mockResolvedValue({ id: 'b-1' });
      prisma.building.delete.mockResolvedValue({ id: 'b-1' });

      const res = await service.remove('b-1');

      expect(prisma.building.delete).toHaveBeenCalledWith({ where: { id: 'b-1' } });
      expect(res).toEqual({ message: '楼栋已删除' });
    });

    it('不存在 → 404 且不删除', async () => {
      prisma.building.findUnique.mockResolvedValue(null);

      await expect(service.remove('nope')).rejects.toThrow(NotFoundException);
      expect(prisma.building.delete).not.toHaveBeenCalled();
    });
  });
});
