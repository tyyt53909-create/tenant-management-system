/**
 * 错误码目录（SEC-09 / QLT-04 T289 共享版）。
 *
 * 文档侧唯一事实来源仍是 `docs/05-接口规范.md` §5.2；本目录由后端
 * `backend/src/common/errors/error-codes.spec.ts` 做双向校验。
 * 三端（backend / frontend-admin / miniprogram）一律从这里引用错误码常量，
 * 禁止手抄字符串（ISS-25：改文案导致逻辑失效）。
 *
 * - `status`：该错误码对应的 HTTP 状态码（数值，不依赖 @nestjs/common）。
 * - `description`：默认用户文案；调用方可以提供更具体的消息，前端展示文案仍归 UI 层。
 *
 * 新增错误码的顺序：先改 docs/05 §5.2，再改这里，后端测试会拦住漏改。
 */
export const ERROR_CATALOG = {
  COMMON_VALIDATION_ERROR: { status: 400, description: '请求参数验证失败' },
  COMMON_BAD_REQUEST: { status: 400, description: '请求参数有误' },
  COMMON_RESOURCE_NOT_FOUND: { status: 404, description: '资源不存在' },
  COMMON_CONFLICT: { status: 409, description: '数据冲突，请刷新后重试' },
  COMMON_INTERNAL_ERROR: { status: 500, description: '服务器内部错误' },
  COMMON_RATE_LIMIT_EXCEEDED: { status: 429, description: '请求过于频繁，请稍后再试' },

  AUTH_INVALID_CREDENTIALS: { status: 401, description: '邮箱/手机号或密码错误' },
  AUTH_TOKEN_EXPIRED: { status: 401, description: '登录已过期，请重新登录' },
  AUTH_TOKEN_INVALID: { status: 401, description: 'Token 无效或已过期' },
  AUTH_REFRESH_ROTATING: {
    status: 401,
    description: '刷新令牌正在轮换中，请稍后重试',
  },
  AUTH_INVITE_CODE_INVALID: { status: 400, description: '邀请码无效' },
  AUTH_INVITE_CODE_EXPIRED: { status: 400, description: '邀请码已过期' },
  AUTH_INVITE_CODE_CONFLICT: { status: 409, description: '邀请码已被使用，请重新获取' },
  AUTH_EMAIL_ALREADY_EXISTS: { status: 409, description: '邮箱已被注册' },
  AUTH_ACCOUNT_NOT_PROVISIONED: { status: 403, description: '账号尚未开通，请联系管理员预建并邀请' },
  AUTH_PROFILE_ALREADY_BOUND: { status: 409, description: '预建租客档案已被绑定，请联系管理员' },
  AUTH_GOOGLE_EMAIL_UNVERIFIED: { status: 401, description: 'Google 邮箱未验证，无法登录' },
  AUTH_IDENTITY_ROLE_CONFLICT: { status: 409, description: '邀请码角色与当前账号角色不匹配' },

  PERM_FORBIDDEN: { status: 403, description: '无权限访问' },
  PERM_INSUFFICIENT_ROLE: { status: 403, description: '权限不足' },
  PERM_BUILDING_ACCESS_DENIED: { status: 403, description: '无权访问该楼栋的数据' },
  CAPABILITY_DENIED: { status: 403, description: '该功能已被管理员暂停' },

  ROOM_NOT_AVAILABLE: { status: 422, description: '房间当前不可用' },
  ROOM_NOT_CLEAN: { status: 422, description: '房间未清洁' },
  ROOM_ALREADY_OCCUPIED: { status: 409, description: '房间已被占用' },
  ROOM_VERSION_CONFLICT: { status: 409, description: '房间状态已被其他用户修改，请刷新后重试' },

  CONTRACT_ROOM_OCCUPIED: { status: 422, description: '房间已有生效合同' },
  CONTRACT_INVALID_DATE_RANGE: { status: 400, description: '合同日期范围无效' },
  CONTRACT_CANNOT_TERMINATE: { status: 422, description: '合同当前状态不可终止' },
  CONTRACT_ALREADY_RENEWED: { status: 422, description: '合同已续签' },

  BILL_ALREADY_PAID: { status: 422, description: '账单已缴清' },
  BILL_PAYMENT_EXCEEDS_AMOUNT: { status: 400, description: '收款金额超过应缴金额' },
  BILL_CANNOT_CANCEL: { status: 422, description: '账单当前状态不可取消' },

  PREPAY_INSUFFICIENT_BALANCE: { status: 422, description: '余额不足' },
  PREPAY_INVALID_AMOUNT: { status: 400, description: '金额无效（必须为正数）' },

  MAINTENANCE_INVALID_STATUS_TRANSITION: { status: 422, description: '无效的状态转换' },
  MAINTENANCE_CANNOT_CANCEL: { status: 422, description: '工单当前状态不可取消' },
  MAINTENANCE_TOO_MANY_PHOTOS: { status: 400, description: '照片数量超过 9 张上限' },

  CHECKOUT_CONTRACT_NOT_ACTIVE: { status: 422, description: '合同未生效或已终止' },
  CHECKOUT_ALREADY_EXISTS: { status: 409, description: '该合同已有退租记录' },
  CHECKOUT_CANNOT_MODIFY: { status: 422, description: '结算单已锁定，不可修改' },
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
