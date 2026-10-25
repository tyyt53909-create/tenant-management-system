import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto.js';
import { sanitizeAuditValue } from './audit-sanitizer.js';

export interface AuditRecord {
  tx?: Prisma.TransactionClient;
  userId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  changes: unknown;
  ip?: string;
  userAgent?: string;
}

export interface BusinessEventRecord {
  tx?: Prisma.TransactionClient;
  action: string;
  entityType: string;
  entityId: string;
  actorId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string;
  ip?: string;
  userAgent?: string;
  context?: Record<string, unknown>;
}

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 记录业务审计事件（支持业务事务同生共死）。
   * 若传入 tx，则与业务数据同一数据库事务提交或回滚；若审计失败，业务事务亦中止。
   * 自动对 before/after 进行深度递归脱敏。
   */
  async recordEvent(event: BusinessEventRecord) {
    const client = event.tx ?? this.prisma;
    const sanitizedChanges = {
      before: sanitizeAuditValue(event.before ?? null),
      after: sanitizeAuditValue(event.after ?? null),
      reason: event.reason,
      actor: event.actorId ?? 'SYSTEM',
      context: event.context,
    };

    let userId: string | null = null;
    if (event.actorId && event.actorId !== 'SYSTEM') {
      const user = await client.user.findUnique({
        where: { id: event.actorId },
        select: { id: true },
      });
      if (user) {
        userId = user.id;
      }
    }

    return client.auditLog.create({
      data: {
        userId,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        changes: sanitizedChanges as never,
        ip: event.ip || '127.0.0.1',
        userAgent: event.userAgent || 'system',
      },
    });
  }

  async log(record: AuditRecord) {
    const client = record.tx ?? this.prisma;
    const sanitizedChanges = sanitizeAuditValue(record.changes);
    const userId = record.userId && record.userId !== 'SYSTEM' ? record.userId : null;
    try {
      return await client.auditLog.create({
        data: {
          userId,
          action: record.action,
          entityType: record.entityType,
          entityId: record.entityId,
          changes: sanitizedChanges as never,
          ip: record.ip || '127.0.0.1',
          userAgent: record.userAgent || 'system',
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        // SEC-06：若操作者外键无效（例如匿名请求、无效 token 或用户在并发异步期间被清理），降级为 null 并保留原始标识，绝不崩溃
        return await client.auditLog.create({
          data: {
            userId: null,
            action: record.action,
            entityType: record.entityType,
            entityId: record.entityId,
            changes: {
              ...(typeof sanitizedChanges === 'object' && sanitizedChanges !== null ? sanitizedChanges : {}),
              _unmatchedUserId: record.userId,
            } as never,
            ip: record.ip || '127.0.0.1',
            userAgent: record.userAgent || 'system',
          },
        });
      }
      throw error;
    }
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
        include: {
          user: { select: { id: true, email: true, role: true } },
        },
      }),
      this.prisma.auditLog.count({ where: where as never }),
    ]);

    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }
}
