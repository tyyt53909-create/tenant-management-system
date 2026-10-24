import { AuditLogInterceptor, sanitizeAuditValue } from './audit-log.interceptor.js';
import { of } from 'rxjs';

describe('audit sanitization', () => {
  it('recursively masks nested sensitive fields and array items without rewriting safe values', () => {
    expect(sanitizeAuditValue({ keep: 'same', nested: [{ passwordHash: 'secret', phone: '123', safe: 1 }] })).toEqual({
      keep: 'same', nested: [{ passwordHash: '[REDACTED]', phone: '[REDACTED]', safe: 1 }],
    });
  });

  it('handles circular references', () => {
    const value: Record<string, unknown> = { safe: true };
    value.self = value;
    expect(sanitizeAuditValue(value)).toEqual({ safe: true, self: '[Circular]' });
  });

  it('does not mutate objects without sensitive fields', () => {
    const value = { name: 'Room', nested: [1, { active: true }] };
    expect(sanitizeAuditValue(value)).toEqual(value);
    expect(sanitizeAuditValue(value)).not.toBe(value);
  });
});

describe('AuditLogInterceptor', () => {
  const user = { userId: 'user-1' };
  const makeContext = (method: string, path = '/api/rooms', actor: unknown = user) => {
    const request = {
      method, path, url: path, body: { name: 'New', email: 'private@example.com', nested: [{ token: 'secret' }] },
      params: {}, query: {}, ip: '127.0.0.1', user, headers: { 'user-agent': 'test', cookie: 'secret', authorization: 'secret', 'x-request-id': 'req-1' },
    };
    if (actor === null) delete (request as { user?: unknown }).user;
    else (request as { user?: unknown }).user = actor;
    return {
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ statusCode: 201 }) }),
    } as never;
  };
  const next = { handle: () => of('ok') };
  let audit: { log: ReturnType<typeof vi.fn> };
  let interceptor: AuditLogInterceptor;

  beforeEach(() => {
    audit = { log: vi.fn().mockResolvedValue(undefined) };
    interceptor = new AuditLogInterceptor(audit as never);
  });

  it('skips GET requests', () => {
    interceptor.intercept(makeContext('GET'), next).subscribe();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('skips anonymous writes and health/docs endpoints', () => {
    interceptor.intercept(makeContext('POST', '/api/rooms', null), next).subscribe();
    interceptor.intercept(makeContext('POST', '/health/live'), next).subscribe();
    interceptor.intercept(makeContext('POST', '/api/docs'), next).subscribe();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('records sanitized structured changes and request context without headers', () => {
    interceptor.intercept(makeContext('POST'), next).subscribe();
    const record = audit.log.mock.calls[0][0];
    expect(record.changes).toMatchObject({
      before: {},
      after: { name: 'New', email: '[REDACTED]', nested: [{ token: '[REDACTED]' }] },
      diff: [
        { field: 'name', before: null, after: 'New' },
        { field: 'email', before: null, after: '[REDACTED]' },
        { field: 'nested', before: null, after: [{ token: '[REDACTED]' }] },
      ],
      context: { requestId: 'req-1', method: 'POST', path: '/api/rooms', statusCode: 201 },
    });
    expect(JSON.stringify(record)).not.toContain('private@example.com');
    expect(JSON.stringify(record)).not.toContain('secret');
  });

  it('logs audit persistence failures without throwing into the request', () => {
    const error = new Error('db unavailable');
    audit.log.mockRejectedValue(error);
    const logger = vi.spyOn((interceptor as unknown as { logger: { error: (...args: unknown[]) => void } }).logger, 'error').mockImplementation(() => undefined);
    interceptor.intercept(makeContext('PUT'), next).subscribe();
    expect(audit.log).toHaveBeenCalled();
    return Promise.resolve().then(() => expect(logger).toHaveBeenCalled());
  });
});
