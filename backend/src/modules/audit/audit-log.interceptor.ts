import { Injectable, Logger, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { AuditLogService } from './audit-log.service.js';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const SENSITIVE_KEY = /password|passwordhash|code|token|authorization|cookie|idnumber|idcard|phone|email/i;
const REDACTED = '[REDACTED]';

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key.replace(/[^a-z0-9]/gi, ''));
}

type AuditRequest = Request & { user?: AuthUser; requestId?: string };

/** Copies JSON-like data while masking secrets and safely handling cycles. */
export function sanitizeAuditValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeAuditValue(item, seen));
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = isSensitiveKey(key) ? REDACTED : sanitizeAuditValue(child, seen);
  }
  return result;
}

function bodyDiff(body: unknown): Array<{ field: string; before: unknown; after: unknown }> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return [];
  return Object.entries(body).map(([field, after]) => {
    const sanitized = sanitizeAuditValue({ [field]: after }) as Record<string, unknown>;
    return { field, before: null, after: sanitized[field] };
  });
}

function isExcludedPath(path: string): boolean {
  const pathname = path.split('?')[0].replace(/\/$/, '');
  return /^\/(?:health(?:\/|$)|api\/health(?:\/|$)|(?:api\/)?docs(?:\/|$)|api-json(?:\/|$))/.test(pathname);
}

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(private readonly auditLogService: AuditLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuditRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const method = request.method?.toUpperCase() ?? '';
    const path = request.path ?? request.url ?? '';
    if (!WRITE_METHODS.has(method) || isExcludedPath(path)) return next.handle();
    const userId = request.user?.userId;
    if (!userId) return next.handle();

    return next.handle().pipe(
      tap({
        next: () => {
          const after = sanitizeAuditValue(request.body ?? {});
          const changes = {
            before: {},
            after,
            diff: bodyDiff(request.body),
            context: {
              requestId: request.requestId ?? (typeof request.headers['x-request-id'] === 'string' ? request.headers['x-request-id'] : undefined),
              method,
              path,
              statusCode: response.statusCode,
            },
          };
          void this.auditLogService.log({
            userId,
            action: `${method} ${path}`,
            entityType: this.entityType(path),
            entityId: (Array.isArray(request.params?.id) ? request.params.id[0] : request.params?.id) ?? '-',
            changes,
            ip: request.ip ?? 'unknown',
            userAgent: request.headers?.['user-agent'] ?? 'unknown',
          }).catch((error: unknown) => {
            this.logger.error(`Audit write failed for ${method} ${path}`, error instanceof Error ? error.stack : String(error));
          });
        },
      }),
    );
  }

  private entityType(path: string): string {
    const match = /\/api\/([^/?]+)/.exec(path);
    return match?.[1] ?? 'unknown';
  }
}
