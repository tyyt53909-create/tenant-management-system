import request from '@/utils/request';
import type { AuditLog } from '@/types';

export interface AuditLogQuery {
  page?: number;
  limit?: number;
  /** 实体类型，如 rooms / bills / tenants */
  entityType?: string;
  /** 具体实体 id */
  entityId?: string;
  /** 操作者 userId */
  userId?: string;
}

/**
 * 审计日志列表（分页，按 createdAt 倒序）
 *
 * 仅 ADMIN 可访问；数据由 AuditLogInterceptor 对**所有写操作**
 * （POST/PATCH/PUT/DELETE）自动记录，不可手工写入。
 */
export const getAuditLogs = (params: AuditLogQuery = {}) => {
  return request.get('/audit-logs', { params });
};

export type { AuditLog };
