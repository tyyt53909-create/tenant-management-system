import type { IncomingMessage } from 'node:http';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { resolveRequestId } from '../common/filters/all-exceptions.filter.js';

const REDACTED = '[Redacted]';

type LoggedRequest = IncomingMessage & {
  id?: string;
  requestId?: string;
  body?: Record<string, unknown>;
  user?: { userId?: string; sub?: string };
};

/**
 * JSON 访问日志。nestjs-pino 5 要求 Node >= 22.12，而 CI 仍是 Node 20，
 * 所以直接使用同一套 pino / pino-http。
 */
export function createHttpLogger(stream?: pino.DestinationStream) {
  const logger = pino(
    {
      level: process.env.LOG_LEVEL || 'info',
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.password',
          'req.body.code',
          'req.body.refreshToken',
          'req.body.accessToken',
          'req.body.idToken',
        ],
        censor: REDACTED,
      },
    },
    stream,
  );

  return pinoHttp({
    logger,
    genReqId(req, res) {
      const request = req as LoggedRequest;
      const requestId = resolveRequestId({
        requestId: request.requestId,
        headers: request.headers as Record<string, unknown>,
      });
      request.requestId = requestId;
      res.setHeader('X-Request-Id', requestId);
      return requestId;
    },
    customProps(req) {
      const request = req as LoggedRequest;
      return {
        requestId: request.id,
        userId: request.user?.userId || request.user?.sub || null,
      };
    },
    customSuccessMessage: () => 'request completed',
    customErrorMessage: () => 'request failed',
    serializers: {
      req(req) {
        const request = req as LoggedRequest;
        return {
          id: request.id,
          method: request.method,
          url: request.url,
          headers: {
            authorization: secret(request.headers.authorization),
          },
          body: {
            password: secret(request.body?.password),
            code: secret(request.body?.code),
          },
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  });
}

function secret(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return REDACTED;
}
