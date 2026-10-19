import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { TagsService } from './tags.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

class UniqueViolation extends Error {
  code = 'P2002';
}

describe('TagsService', () => {
  let service: TagsService;
  let prisma: {
    tag: {
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TagsService,
        {
          provide: PrismaService,
          useValue: {
            tag: {
              findMany: vi.fn().mockResolvedValue([]),
              findFirst: vi.fn().mockResolvedValue(null),
              findUnique: vi.fn().mockResolvedValue({ id: 'tag-1' }),
              create: vi.fn(),
              update: vi.fn(),
              delete: vi.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get(TagsService);
    prisma = module.get(PrismaService) as never;
  });

  it('列表附带使用人数并去掉 _count', async () => {
    prisma.tag.findMany.mockResolvedValue([
      { id: 'tag-a', name: '学生', sort: 0, createdAt: new Date(), _count: { tenants: 3 } },
    ]);

    const result = await service.findAll();

    expect(result).toEqual([
      { id: 'tag-a', name: '学生', sort: 0, createdAt: expect.any(Date), tenantCount: 3 },
    ]);
  });

  it('新建标签：未指定顺序时排到最后一个之后', async () => {
    prisma.tag.findFirst.mockResolvedValue({ sort: 20 });
    prisma.tag.create.mockResolvedValue({ id: 'tag-new', name: '上班族', sort: 30 });

    const result = await service.create({ name: '  上班族  ' });

    expect(prisma.tag.create).toHaveBeenCalledWith({ data: { name: '上班族', sort: 30 } });
    expect(result.id).toBe('tag-new');
  });

  it('新建重复名称 → 409', async () => {
    prisma.tag.create.mockRejectedValue(new UniqueViolation());

    await expect(service.create({ name: '学生' })).rejects.toThrow(ConflictException);
  });

  it('改名重复 → 409', async () => {
    prisma.tag.update.mockRejectedValue(new UniqueViolation());

    await expect(service.update('tag-1', { name: '学生' })).rejects.toThrow(ConflictException);
  });

  it('更新不存在的标签 → 404', async () => {
    prisma.tag.findUnique.mockResolvedValue(null);

    await expect(service.update('tag-ghost', { name: '学生' })).rejects.toThrow(NotFoundException);
  });

  it('删除标签返回受影响的租客数', async () => {
    prisma.tag.delete.mockResolvedValue({ _count: { tenants: 2 } });

    const result = await service.remove('tag-1');

    expect(result).toEqual({ message: '标签已删除', affectedTenants: 2 });
  });

  it('删除不存在的标签 → 404', async () => {
    prisma.tag.findUnique.mockResolvedValue(null);

    await expect(service.remove('tag-ghost')).rejects.toThrow(NotFoundException);
  });
});
