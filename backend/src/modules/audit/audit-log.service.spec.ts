import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogService } from './audit-log.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('AuditLogService', () => {
  let service: AuditLogService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogService,
        {
          provide: PrismaService,
          useValue: {
            auditLog: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
          },
        },
      ],
    }).compile();

    service = module.get<AuditLogService>(AuditLogService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('log 应写入审计记录', async () => {
    vi.spyOn(prisma.auditLog, 'create').mockResolvedValue({ id: 'a-1' } as any);
    const result = await service.log({
      userId: 'u-1',
      action: 'POST /api/rooms',
      entityType: 'rooms',
      entityId: '-',
      changes: {},
      ip: '127.0.0.1',
      userAgent: 'test',
    });
    expect(result.id).toBe('a-1');
  });

  it('findAll 应支持 entity 过滤与分页', async () => {
    vi.spyOn(prisma.auditLog, 'findMany').mockResolvedValue([]);
    vi.spyOn(prisma.auditLog, 'count').mockResolvedValue(0);
    const result = await service.findAll({ page: 1, limit: 20, entityType: 'rooms' });
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ entityType: 'rooms' }) }),
    );
    expect(result.meta.total).toBe(0);
  });
});
