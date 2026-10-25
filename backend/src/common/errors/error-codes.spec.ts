import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ERROR_CATALOG,
  ErrorCode,
  apiError,
  codeForMessage,
  defaultMessageForCode,
  statusForCode,
  type ErrorCodeName,
} from './error-codes.js';

const DOCS_PATH = fileURLToPath(new URL('../../../../docs/05-接口规范.md', import.meta.url));

interface DocCode {
  code: string;
  status: number;
  description: string;
}

function readDocCodes(): DocCode[] {
  const markdown = readFileSync(DOCS_PATH, 'utf8');
  const start = markdown.indexOf('## 5. 错误码体系');
  const end = markdown.indexOf('## 6. ', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  return markdown
    .slice(start, end)
    .split('\n')
    .map((line) => /^\| `([A-Z][A-Z0-9_]+)` \| (\d{3}) \| (.+?) \|$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ code: match[1], status: Number(match[2]), description: match[3] }));
}

describe('错误码目录与 docs/05 一致', () => {
  it('每个文档错误码都在目录中，且状态码一致', () => {
    const docCodes = readDocCodes();
    expect(docCodes.length).toBeGreaterThan(30);

    for (const entry of docCodes) {
      expect(ERROR_CATALOG, `docs/05 中的 ${entry.code} 未登记到 ERROR_CATALOG`).toHaveProperty(entry.code);
      expect(statusForCode(entry.code as ErrorCodeName), `${entry.code} 状态码与文档不一致`).toBe(
        entry.status,
      );
    }
  });

  it('目录中的每个错误码都在 docs/05 有说明', () => {
    const documented = new Set(readDocCodes().map((entry) => entry.code));
    for (const code of Object.keys(ERROR_CATALOG)) {
      expect(documented.has(code), `ERROR_CATALOG 中的 ${code} 未写入 docs/05「5.2 错误码列表」`).toBe(true);
    }
  });

  it('错误码命名与描述符合约定', () => {
    for (const [code, meta] of Object.entries(ERROR_CATALOG)) {
      expect(code).toMatch(/^[A-Z][A-Z0-9_]+$/);
      expect(meta.status).toBeGreaterThanOrEqual(400);
      expect(meta.status).toBeLessThan(600);
      expect(meta.description.length).toBeGreaterThan(0);
    }
  });
});

describe('apiError', () => {
  it('使用目录中的状态码与默认文案', () => {
    const error = apiError(ErrorCode.ROOM_VERSION_CONFLICT);
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toEqual({
      code: 'ROOM_VERSION_CONFLICT',
      message: defaultMessageForCode(ErrorCode.ROOM_VERSION_CONFLICT),
    });
  });

  it('允许覆盖文案并附带 details', () => {
    const error = apiError(ErrorCode.BILL_ALREADY_PAID, '账单已缴清，无需计算滞纳金', { billId: 'b1' });
    expect(error.getStatus()).toBe(422);
    expect(error.getResponse()).toEqual({
      code: 'BILL_ALREADY_PAID',
      message: '账单已缴清，无需计算滞纳金',
      details: { billId: 'b1' },
    });
  });
});

describe('codeForMessage 兜底', () => {
  it('显式 code 在目录内时优先', () => {
    expect(codeForMessage(400, '随便什么文案', 'ROOM_NOT_AVAILABLE')).toBe('ROOM_NOT_AVAILABLE');
  });

  it('显式 code 不在目录内时忽略，退回消息/状态推断', () => {
    expect(codeForMessage(403, '无权限', 'NOT_A_REAL_CODE')).toBe('PERM_FORBIDDEN');
  });

  it('仍兼容历史消息映射', () => {
    expect(codeForMessage(400, '邀请码无效或已过期')).toBe('AUTH_INVITE_CODE_INVALID');
    expect(codeForMessage(400, '邀请码已过期')).toBe('AUTH_INVITE_CODE_EXPIRED');
    expect(codeForMessage(422, '不允许的房态流转：VACANT → OCCUPIED')).toBe('ROOM_NOT_AVAILABLE');
  });

  it('按状态码兜底归码（T289 补齐分支覆盖）', () => {
    expect(codeForMessage(401, '任何文案')).toBe('AUTH_TOKEN_INVALID');
    expect(codeForMessage(403, '任何文案')).toBe('PERM_FORBIDDEN');
    expect(codeForMessage(404, '任何文案')).toBe('COMMON_RESOURCE_NOT_FOUND');
    expect(codeForMessage(409, '任何文案')).toBe('COMMON_CONFLICT');
    expect(codeForMessage(429, '任何文案')).toBe('COMMON_RATE_LIMIT_EXCEEDED');
    expect(codeForMessage(400, '字段；字段2')).toBe('COMMON_VALIDATION_ERROR');
    expect(codeForMessage(400, '普通错误')).toBe('COMMON_BAD_REQUEST');
    expect(codeForMessage(500, '未知错误')).toBe('COMMON_INTERNAL_ERROR');
  });

  it('消息关键词兜底（收款/缴清）', () => {
    expect(codeForMessage(400, '收款金额不能超过应缴')).toBe('BILL_PAYMENT_EXCEEDS_AMOUNT');
    expect(codeForMessage(422, '该账单已缴清')).toBe('BILL_ALREADY_PAID');
  });
});
