import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { AuditLogService } from './audit-log.service.js';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

type AuditRequest = Request & { user?: AuthUser };

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private readonly auditLogService: AuditLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuditRequest>();
    if (!WRITE_METHODS.has(request.method)) return next.handle();
    if (request.url?.startsWith('/api/auth/')) return next.handle();

    return next.handle().pipe(
      tap({
        next: () => {
          void this.auditLogService
            .log({
              userId: request.user?.userId ?? 'anonymous',
              action: `${request.method} ${request.url}`,
              entityType: this.entityType(request.url),
              entityId: (Array.isArray(request.params?.id) ? request.params.id[0] : request.params?.id) ?? '-',
              changes: { body: request.body, params: request.params, query: request.query },
              ip: request.ip ?? 'unknown',
              userAgent: request.headers?.['user-agent'] ?? 'unknown',
            })
            .catch(() => undefined);
        },
      }),
    );
  }

  private entityType(url: string): string {
    const match = /\/api\/([^/?]+)/.exec(url ?? '');
    return match?.[1] ?? 'unknown';
  }
}
