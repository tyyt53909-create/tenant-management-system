import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto.js';

export interface AuditRecord {
  userId?: string;
  action: string;
  entityType: string;
  entityId: string;
  changes: unknown;
  ip: string;
  userAgent: string;
}

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async log(record: AuditRecord) {
    // 匿名请求允许 userId 为空；绝不伪造操作者（SEC-06 / T270）。
    return this.prisma.auditLog.create({
      data: {
        ...record,
        userId: record.userId ?? null,
        changes: record.changes as never,
      },
    });
  }

  async findAll(query: QueryAuditLogsDto) {
    const { page = 1, limit = 20, entityType, entityId, userId } = query;
    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = {};
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;
    if (userId) where.userId = userId;

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: where as never,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        // 审计的核心是「谁做的」，必须带出操作者信息；
        // 此前只存 userId 不 include，前端拿不到可读的操作者
        include: {
          user: { select: { id: true, email: true, role: true } },
        },
      }),
      this.prisma.auditLog.count({ where: where as never }),
    ]);

    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }
}
