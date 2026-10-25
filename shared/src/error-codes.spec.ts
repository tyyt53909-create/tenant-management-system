import { describe, expect, it } from 'vitest';
import {
  ERROR_CATALOG,
  ErrorCode,
  defaultMessageForCode,
  statusForCode,
  type ErrorCodeName,
} from './error-codes.js';

describe('共享错误码目录', () => {
  it('错误码命名与状态码符合约定', () => {
    for (const [code, meta] of Object.entries(ERROR_CATALOG)) {
      expect(code).toMatch(/^[A-Z][A-Z0-9_]+$/);
      expect(meta.status).toBeGreaterThanOrEqual(400);
      expect(meta.status).toBeLessThan(600);
      expect(meta.description.length).toBeGreaterThan(0);
    }
  });

  it('ErrorCode 常量表与目录键一一对应', () => {
    expect(Object.keys(ErrorCode).sort()).toEqual(Object.keys(ERROR_CATALOG).sort());
    for (const key of Object.keys(ERROR_CATALOG)) {
      expect(ErrorCode[key as ErrorCodeName]).toBe(key);
    }
  });

  it('statusForCode / defaultMessageForCode 读取目录', () => {
    expect(statusForCode('ROOM_VERSION_CONFLICT')).toBe(409);
    expect(defaultMessageForCode('BILL_ALREADY_PAID')).toBe('账单已缴清');
  });

  it('后端目录与本目录完全一致（防三端漂移）', async () => {
    const backend = await import('../../backend/src/common/errors/error-codes.js') as typeof import('./error-codes.js');
    const backendCatalog = backend.ERROR_CATALOG as Record<string, { status: number; description: string }>;
    expect(Object.keys(backendCatalog).sort()).toEqual(Object.keys(ERROR_CATALOG).sort());
    for (const [code, meta] of Object.entries(ERROR_CATALOG)) {
      expect(backendCatalog[code].status, `${code} 状态码漂移`).toBe(meta.status);
      expect(backendCatalog[code].description, `${code} 文案漂移`).toBe(meta.description);
    }
  });
});
