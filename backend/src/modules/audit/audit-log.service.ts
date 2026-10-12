import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto.js';

export interface AuditRecord {
  userId: string;
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
    return this.prisma.auditLog.create({ data: { ...record, changes: record.changes as never } });
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
      }),
      this.prisma.auditLog.count({ where: where as never }),
    ]);

    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }
}
