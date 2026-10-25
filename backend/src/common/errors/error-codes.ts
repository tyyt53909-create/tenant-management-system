import { HttpException } from '@nestjs/common';
import {
  ERROR_CATALOG,
  ErrorCode,
  defaultMessageForCode,
  statusForCode,
  type ErrorCodeName,
} from '../../../../shared/src/error-codes.js';
export { ERROR_CATALOG, ErrorCode, defaultMessageForCode, statusForCode };
export type { ErrorCodeName };

/**
 * 错误码目录（SEC-09）：唯一事实来源是 `docs/05-接口规范.md` §5.2，
 * 目录本体在 `shared/src/error-codes.ts`（QLT-04 / T289 三端共享），
 * 本文件只保留 NestJS 抛错便利层，并由 `error-codes.spec.ts` 做与 docs/05 的双向校验。
 *
 * - `status`：该错误码对应的 HTTP 状态码；抛错时用它，不再按消息猜。
 * - `description`：默认用户文案；调用方可以提供更具体的消息。
 *
 * 新增错误码的顺序：先改 docs/05 §5.2，再改 shared/src/error-codes.ts，测试会拦住漏改。
 */

/**
 * 抛业务错误的推荐方式：状态码来自目录，响应体带稳定的 `code`。
 * 迁移期间仍允许直接 `throw new BadRequestException(...)`，过滤器会按消息兜底映射。
 */
export function apiError(code: ErrorCodeName, message?: string, details?: unknown): HttpException {
  return new HttpException(
    {
      code,
      message: message ?? defaultMessageForCode(code),
      ...(details === undefined ? {} : { details }),
    },
    statusForCode(code),
  );
}

const EXACT_MESSAGE_CODES: Record<string, ErrorCodeName> = {
  CAPABILITY_DENIED: ErrorCode.CAPABILITY_DENIED,
  '邮箱/手机号或密码错误': ErrorCode.AUTH_INVALID_CREDENTIALS,
  '该账号未设置密码，请使用 Google 第三方登录': ErrorCode.AUTH_INVALID_CREDENTIALS,
  'Token 无效或已过期': ErrorCode.AUTH_TOKEN_INVALID,
  '刷新令牌正在轮换中，请稍后重试': ErrorCode.AUTH_REFRESH_ROTATING,
  'Token 用途不匹配，请提供 Refresh Token': ErrorCode.AUTH_TOKEN_INVALID,
  '无效的 Refresh Token，禁止用于刷新': ErrorCode.AUTH_TOKEN_INVALID,
  '登录会话不可用': ErrorCode.AUTH_TOKEN_INVALID,
  '刷新令牌已重复使用，所有会话已失效': ErrorCode.AUTH_TOKEN_INVALID,
  '禁止使用 Refresh Token 访问受保护接口': ErrorCode.AUTH_TOKEN_INVALID,
  '用户不存在或已禁用': ErrorCode.AUTH_TOKEN_INVALID,
  '邀请码无效': ErrorCode.AUTH_INVITE_CODE_INVALID,
  '邀请码无效或已过期': ErrorCode.AUTH_INVITE_CODE_INVALID,
  '邀请码已过期': ErrorCode.AUTH_INVITE_CODE_EXPIRED,
  '邮箱已被注册': ErrorCode.AUTH_EMAIL_ALREADY_EXISTS,
  '邮箱已被使用': ErrorCode.AUTH_EMAIL_ALREADY_EXISTS,
  '权限不足': ErrorCode.PERM_INSUFFICIENT_ROLE,
  '未授权访问': ErrorCode.PERM_FORBIDDEN,
  '账号已被禁用': ErrorCode.PERM_FORBIDDEN,
  '无权访问该楼栋的数据': ErrorCode.PERM_BUILDING_ACCESS_DENIED,
  '房间状态已被其他用户修改，请刷新后重试': ErrorCode.ROOM_VERSION_CONFLICT,
  '余额不足，无法扣费/退款': ErrorCode.PREPAY_INSUFFICIENT_BALANCE,
  '调整金额不能为 0': ErrorCode.PREPAY_INVALID_AMOUNT,
  '该交易号已登记过，请勿重复收款': ErrorCode.COMMON_CONFLICT,
};

/**
 * 过渡期兜底：未显式带 `code` 的旧抛错按消息/状态码归码。
 * 新代码请直接用 `apiError()`，不要再往这里加消息。
 */
export function codeForMessage(status: number, message: string, explicitCode?: string): ErrorCodeName {
  if (explicitCode && explicitCode in ERROR_CATALOG) {
    return explicitCode as ErrorCodeName;
  }
  const exact = EXACT_MESSAGE_CODES[message];
  if (exact) return exact;
  if (message.startsWith('不允许的房态流转')) return ErrorCode.ROOM_NOT_AVAILABLE;
  if (message.includes('收款金额') && message.includes('超过')) return ErrorCode.BILL_PAYMENT_EXCEEDS_AMOUNT;
  if (message.includes('已缴清')) return ErrorCode.BILL_ALREADY_PAID;
  if (status === 401) return ErrorCode.AUTH_TOKEN_INVALID;
  if (status === 403) return ErrorCode.PERM_FORBIDDEN;
  if (status === 404) return ErrorCode.COMMON_RESOURCE_NOT_FOUND;
  if (status === 409) return ErrorCode.COMMON_CONFLICT;
  if (status === 429) return ErrorCode.COMMON_RATE_LIMIT_EXCEEDED;
  if (status === 400 && message.includes('；')) return ErrorCode.COMMON_VALIDATION_ERROR;
  if (status === 400) return ErrorCode.COMMON_BAD_REQUEST;
  return ErrorCode.COMMON_INTERNAL_ERROR;
}
