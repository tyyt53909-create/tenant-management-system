import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 错误码目录（SEC-09）：唯一事实来源是 `docs/05-接口规范.md` §5.2，
 * 本文件逐项镜像它，并由 `error-codes.spec.ts` 做双向校验。
 *
 * - `status`：该错误码对应的 HTTP 状态码；抛错时用它，不再按消息猜。
 * - `description`：默认用户文案；调用方可以提供更具体的消息。
 *
 * 新增错误码的顺序：先改 docs/05 §5.2，再改这里，测试会拦住漏改。
 */
export const ERROR_CATALOG = {
  COMMON_VALIDATION_ERROR: { status: HttpStatus.BAD_REQUEST, description: '请求参数验证失败' },
  COMMON_BAD_REQUEST: { status: HttpStatus.BAD_REQUEST, description: '请求参数有误' },
  COMMON_RESOURCE_NOT_FOUND: { status: HttpStatus.NOT_FOUND, description: '资源不存在' },
  COMMON_CONFLICT: { status: HttpStatus.CONFLICT, description: '数据冲突，请刷新后重试' },
  COMMON_INTERNAL_ERROR: { status: HttpStatus.INTERNAL_SERVER_ERROR, description: '服务器内部错误' },
  COMMON_RATE_LIMIT_EXCEEDED: { status: HttpStatus.TOO_MANY_REQUESTS, description: '请求过于频繁，请稍后再试' },

  AUTH_INVALID_CREDENTIALS: { status: HttpStatus.UNAUTHORIZED, description: '邮箱/手机号或密码错误' },
  AUTH_TOKEN_EXPIRED: { status: HttpStatus.UNAUTHORIZED, description: '登录已过期，请重新登录' },
  AUTH_TOKEN_INVALID: { status: HttpStatus.UNAUTHORIZED, description: 'Token 无效或已过期' },
  AUTH_REFRESH_ROTATING: {
    status: HttpStatus.UNAUTHORIZED,
    description: '刷新令牌正在轮换中，请稍后重试',
  },
  AUTH_INVITE_CODE_INVALID: { status: HttpStatus.BAD_REQUEST, description: '邀请码无效' },
  AUTH_INVITE_CODE_EXPIRED: { status: HttpStatus.BAD_REQUEST, description: '邀请码已过期' },
  AUTH_INVITE_CODE_CONFLICT: { status: HttpStatus.CONFLICT, description: '邀请码已被使用，请重新获取' },
  AUTH_EMAIL_ALREADY_EXISTS: { status: HttpStatus.CONFLICT, description: '邮箱已被注册' },
  AUTH_ACCOUNT_NOT_PROVISIONED: { status: HttpStatus.FORBIDDEN, description: '账号尚未开通，请联系管理员预建并邀请' },
  AUTH_GOOGLE_EMAIL_UNVERIFIED: { status: HttpStatus.UNAUTHORIZED, description: 'Google 邮箱未验证，无法登录' },
  AUTH_IDENTITY_ROLE_CONFLICT: { status: HttpStatus.CONFLICT, description: '邀请码角色与当前账号角色不匹配' },

  PERM_FORBIDDEN: { status: HttpStatus.FORBIDDEN, description: '无权限访问' },
  PERM_INSUFFICIENT_ROLE: { status: HttpStatus.FORBIDDEN, description: '权限不足' },
  PERM_BUILDING_ACCESS_DENIED: { status: HttpStatus.FORBIDDEN, description: '无权访问该楼栋的数据' },
  CAPABILITY_DENIED: { status: HttpStatus.FORBIDDEN, description: '该功能已被管理员暂停' },

  ROOM_NOT_AVAILABLE: { status: HttpStatus.UNPROCESSABLE_ENTITY, description: '房间当前不可用' },
  ROOM_NOT_CLEAN: { status: HttpStatus.UNPROCESSABLE_ENTITY, description: '房间未清洁' },
  ROOM_ALREADY_OCCUPIED: { status: HttpStatus.CONFLICT, description: '房间已被占用' },
  ROOM_VERSION_CONFLICT: { status: HttpStatus.CONFLICT, description: '房间状态已被其他用户修改，请刷新后重试' },

  CONTRACT_ROOM_OCCUPIED: { status: HttpStatus.UNPROCESSABLE_ENTITY, description: '房间已有生效合同' },
  CONTRACT_INVALID_DATE_RANGE: { status: HttpStatus.BAD_REQUEST, description: '合同日期范围无效' },
  CONTRACT_CANNOT_TERMINATE: { status: HttpStatus.UNPROCESSABLE_ENTITY, description: '合同当前状态不可终止' },
  CONTRACT_ALREADY_RENEWED: { status: HttpStatus.UNPROCESSABLE_ENTITY, description: '合同已续签' },

  BILL_ALREADY_PAID: { status: HttpStatus.UNPROCESSABLE_ENTITY, description: '账单已缴清' },
  BILL_PAYMENT_EXCEEDS_AMOUNT: { status: HttpStatus.BAD_REQUEST, description: '收款金额超过应缴金额' },
  BILL_CANNOT_CANCEL: { status: HttpStatus.UNPROCESSABLE_ENTITY, description: '账单当前状态不可取消' },

  PREPAY_INSUFFICIENT_BALANCE: { status: HttpStatus.UNPROCESSABLE_ENTITY, description: '余额不足' },
  PREPAY_INVALID_AMOUNT: { status: HttpStatus.BAD_REQUEST, description: '金额无效（必须为正数）' },

  MAINTENANCE_INVALID_STATUS_TRANSITION: { status: HttpStatus.UNPROCESSABLE_ENTITY, description: '无效的状态转换' },
  MAINTENANCE_CANNOT_CANCEL: { status: HttpStatus.UNPROCESSABLE_ENTITY, description: '工单当前状态不可取消' },
  MAINTENANCE_TOO_MANY_PHOTOS: { status: HttpStatus.BAD_REQUEST, description: '照片数量超过 9 张上限' },

  CHECKOUT_CONTRACT_NOT_ACTIVE: { status: HttpStatus.UNPROCESSABLE_ENTITY, description: '合同未生效或已终止' },
  CHECKOUT_ALREADY_EXISTS: { status: HttpStatus.CONFLICT, description: '该合同已有退租记录' },
  CHECKOUT_CANNOT_MODIFY: { status: HttpStatus.UNPROCESSABLE_ENTITY, description: '结算单已锁定，不可修改' },
} as const;

export type ErrorCodeName = keyof typeof ERROR_CATALOG;

/** 兼容既有 `ErrorCode.XXX` 写法；值就是错误码本身。 */
export const ErrorCode = Object.freeze(
  Object.fromEntries(Object.keys(ERROR_CATALOG).map((key) => [key, key])),
) as { readonly [K in ErrorCodeName]: K };

export function statusForCode(code: ErrorCodeName): number {
  return ERROR_CATALOG[code].status;
}

export function defaultMessageForCode(code: ErrorCodeName): string {
  return ERROR_CATALOG[code].description;
}

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
