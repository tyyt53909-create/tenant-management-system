import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { ErrorCode, codeForMessage, type ErrorCodeName } from '../errors/error-codes.js';

export interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
  requestId: string;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const GENERIC_INTERNAL_MESSAGE = '服务器内部错误';

type RequestWithId = Request & { requestId?: string };

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  /**
   * `nodeEnv` 由启动期配置传入（config 层解析 NODE_ENV），此处不读 process.env。
   * 默认值仅为单测直接 `new AllExceptionsFilter()` 时兜底。
   */
  constructor(private readonly nodeEnv = 'development') {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<RequestWithId>();
    const requestId = resolveRequestId(request);
    if (!response.headersSent) {
      response.setHeader('X-Request-Id', requestId);
    }

    const mapped = toErrorResponse(exception, requestId, this.nodeEnv);
    if (mapped.status >= 500) {
      this.logger.error(summarizeException(exception, requestId));
    }
    if (!response.headersSent) {
      response.status(mapped.status).json(mapped.body);
    }
  }
}

export function resolveRequestId(request?: { headers?: Record<string, unknown>; requestId?: string }): string {
  if (request?.requestId && REQUEST_ID_PATTERN.test(request.requestId)) return request.requestId;
  const header = request?.headers?.['x-request-id'];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value === 'string' && REQUEST_ID_PATTERN.test(value)) return value;
  return randomUUID();
}

export function requestIdMiddleware(req: RequestWithId, res: Response, next: () => void): void {
  const requestId = resolveRequestId(req);
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}

export function toErrorResponse(
  exception: unknown,
  requestId: string,
  nodeEnv: string | undefined,
): { status: number; body: ErrorBody } {
  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    if (exception.code === 'P2002') {
      const target = Array.isArray(exception.meta?.target) ? exception.meta.target.map(String) : undefined;
      return {
        status: HttpStatus.CONFLICT,
        body: {
          code: ErrorCode.COMMON_CONFLICT,
          message: '数据已存在，请勿重复提交',
          requestId,
          ...(target && nodeEnv !== 'production' ? { details: { target } } : {}),
        },
      };
    }
    if (exception.code === 'P2003') {
      return {
        status: HttpStatus.CONFLICT,
        body: {
          code: ErrorCode.COMMON_CONFLICT,
          message: '存在关联数据，不能删除或修改',
          requestId,
        },
      };
    }
    if (exception.code === 'P2025') {
      return {
        status: HttpStatus.NOT_FOUND,
        body: {
          code: ErrorCode.COMMON_RESOURCE_NOT_FOUND,
          message: '资源不存在',
          requestId,
        },
      };
    }
    return internalError(requestId);
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    if (status >= 500) return internalError(requestId, nodeEnv, exception.message);
    const extracted = extractHttpMessage(exception.getResponse());
    if (status === HttpStatus.TOO_MANY_REQUESTS) {
      return {
        status,
        body: {
          code: ErrorCode.COMMON_RATE_LIMIT_EXCEEDED,
          message: '请求过于频繁，请稍后再试',
          requestId,
        },
      };
    }
    const validation = Array.isArray(extracted.details);
    const code = validation
      ? ErrorCode.COMMON_VALIDATION_ERROR
      : codeForMessage(status, extracted.message, extracted.explicitCode);
    return {
      status,
      body: withDetails({
        code,
        message: clientMessage(code, extracted.message),
        requestId,
      }, extracted.details),
    };
  }

  return internalError(requestId);
}

function extractHttpMessage(raw: string | object): { message: string; details?: unknown; explicitCode?: string } {
  if (typeof raw === 'string') return { message: raw };
  const record = raw as Record<string, unknown>;
  const explicitCode = typeof record.code === 'string' ? record.code : undefined;
  if (Array.isArray(record.message)) {
    const details = record.message.map(String);
    return { message: details.join('；'), details, explicitCode };
  }
  if (typeof record.message === 'string') {
    return { message: record.message, explicitCode, details: record.details };
  }
  return { message: '请求失败', explicitCode };
}

function clientMessage(code: ErrorCodeName, message: string): string {
  if (code === ErrorCode.CAPABILITY_DENIED) return '当前账号的这项功能已暂停';
  if (code === ErrorCode.COMMON_RATE_LIMIT_EXCEEDED) return '请求过于频繁，请稍后再试';
  if (code === ErrorCode.COMMON_CONFLICT && !message) return '数据已存在，请勿重复提交';
  if (looksSensitive(message)) return '请求无法完成';
  return message || '请求失败';
}

function withDetails(body: ErrorBody, details: unknown): ErrorBody {
  if (details === undefined) return body;
  return { ...body, details };
}

function internalError(requestId: string, nodeEnv?: string, message?: string): { status: number; body: ErrorBody } {
  const expose = nodeEnv !== 'production' && message && !looksSensitive(message) ? message : GENERIC_INTERNAL_MESSAGE;
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    body: {
      code: ErrorCode.COMMON_INTERNAL_ERROR,
      message: expose,
      requestId,
    },
  };
}

function looksSensitive(message: string): boolean {
  return /\b(select|insert|update|delete)\b/i.test(message) || message.includes('\n') || message.includes('prisma.');
}

function summarizeException(exception: unknown, requestId: string): string {
  const name = exception instanceof Error ? exception.name : 'Error';
  const message = exception instanceof Error ? exception.message : String(exception);
  const safe = message.replace(/\s+/g, ' ').slice(0, 300);
  return `[${requestId}] ${name}: ${safe}`;
}
