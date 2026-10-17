/** 与 docs/05 §5 对齐。未单列的业务文案仍回传原文，只补上稳定的 code。 */
export const ErrorCode = {
  COMMON_VALIDATION_ERROR: 'COMMON_VALIDATION_ERROR',
  COMMON_BAD_REQUEST: 'COMMON_BAD_REQUEST',
  COMMON_RESOURCE_NOT_FOUND: 'COMMON_RESOURCE_NOT_FOUND',
  COMMON_CONFLICT: 'COMMON_CONFLICT',
  COMMON_INTERNAL_ERROR: 'COMMON_INTERNAL_ERROR',
  COMMON_RATE_LIMIT_EXCEEDED: 'COMMON_RATE_LIMIT_EXCEEDED',
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  AUTH_INVITE_CODE_INVALID: 'AUTH_INVITE_CODE_INVALID',
  AUTH_INVITE_CODE_EXPIRED: 'AUTH_INVITE_CODE_EXPIRED',
  AUTH_EMAIL_ALREADY_EXISTS: 'AUTH_EMAIL_ALREADY_EXISTS',
  PERM_FORBIDDEN: 'PERM_FORBIDDEN',
  PERM_INSUFFICIENT_ROLE: 'PERM_INSUFFICIENT_ROLE',
  PERM_BUILDING_ACCESS_DENIED: 'PERM_BUILDING_ACCESS_DENIED',
  CAPABILITY_DENIED: 'CAPABILITY_DENIED',
  ROOM_NOT_AVAILABLE: 'ROOM_NOT_AVAILABLE',
  ROOM_VERSION_CONFLICT: 'ROOM_VERSION_CONFLICT',
  BILL_ALREADY_PAID: 'BILL_ALREADY_PAID',
  BILL_PAYMENT_EXCEEDS_AMOUNT: 'BILL_PAYMENT_EXCEEDS_AMOUNT',
  PREPAY_INSUFFICIENT_BALANCE: 'PREPAY_INSUFFICIENT_BALANCE',
  PREPAY_INVALID_AMOUNT: 'PREPAY_INVALID_AMOUNT',
} as const;

export type ErrorCodeName = (typeof ErrorCode)[keyof typeof ErrorCode];

const EXACT_MESSAGE_CODES: Record<string, ErrorCodeName> = {
  CAPABILITY_DENIED: ErrorCode.CAPABILITY_DENIED,
  '邮箱/手机号或密码错误': ErrorCode.AUTH_INVALID_CREDENTIALS,
  '该账号未设置密码，请使用 Google 第三方登录': ErrorCode.AUTH_INVALID_CREDENTIALS,
  'Token 无效或已过期': ErrorCode.AUTH_TOKEN_INVALID,
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

export function codeForMessage(status: number, message: string, explicitCode?: string): ErrorCodeName {
  if (explicitCode && /^[A-Z][A-Z0-9_]+$/.test(explicitCode)) {
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
