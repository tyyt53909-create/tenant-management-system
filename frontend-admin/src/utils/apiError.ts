/**
 * 统一错误解析（COM-05 / T285）。
 *
 * 后端 `AllExceptionsFilter` 保证错误响应形如 `{ code, message, details?, requestId }`。
 * 前端一律以 `code` 判断「发生了什么」，`message` 只用于展示；不再用中文文案做条件判断
 * （ISS-25：改文案就会导致逻辑失效，且无法区分 401 的具体原因）。
 * 错误码常量来自共享包（QLT-04 / T289），展示文案仍归前端 UI 层。
 */
import { ErrorCode, type ErrorCodeName } from '../../../shared/src/error-codes.js';

export interface ApiErrorBody {
  code?: string;
  message?: unknown;
  details?: unknown;
  requestId?: string;
}

export interface ParsedApiError {
  /** 后端业务错误码；网络错误/非标准响应时为 undefined */
  code?: string;
  /** 可直接展示给用户的文案 */
  message: string;
  /** HTTP 状态码；网络错误为 undefined */
  status?: number;
  details?: unknown;
  requestId?: string;
  /** 原始异常，便于调用方继续做细分处理 */
  raw: unknown;
}

/** 按错误码覆盖默认文案：同一 code 在不同页面可以有不同语气时，由调用方传 fallback。 */
const CODE_MESSAGES: Partial<Record<ErrorCodeName, string>> = {
  [ErrorCode.CAPABILITY_DENIED]: '当前账号的这项功能已暂停',
  [ErrorCode.COMMON_RATE_LIMIT_EXCEEDED]: '请求过于频繁，请稍后再试',
  [ErrorCode.COMMON_INTERNAL_ERROR]: '服务器内部错误，请稍后重试',
  [ErrorCode.COMMON_RESOURCE_NOT_FOUND]: '资源不存在或已被删除',
  [ErrorCode.COMMON_CONFLICT]: '数据已存在或被其他操作改动，请刷新后重试',
  [ErrorCode.AUTH_TOKEN_EXPIRED]: '登录已过期，请重新登录',
  [ErrorCode.AUTH_TOKEN_INVALID]: '登录状态无效，请重新登录',
  [ErrorCode.AUTH_INVALID_CREDENTIALS]: '邮箱/手机号或密码错误',
  [ErrorCode.AUTH_REFRESH_ROTATING]: '登录状态更新中，请稍后重试',
  [ErrorCode.PERM_FORBIDDEN]: '没有权限执行该操作',
  [ErrorCode.PERM_INSUFFICIENT_ROLE]: '当前角色无权执行该操作',
  [ErrorCode.ROOM_VERSION_CONFLICT]: '房态已被其他人更新，请刷新后重试',
  [ErrorCode.BILL_ALREADY_PAID]: '账单已缴清',
  [ErrorCode.BILL_PAYMENT_EXCEEDS_AMOUNT]: '收款金额超过应缴金额',
  [ErrorCode.PREPAY_INSUFFICIENT_BALANCE]: '预付余额不足',
};

/** 网络错误（请求未到达服务端）的统一文案。 */
export const NETWORK_ERROR_MESSAGE = '网络错误，请检查网络连接';

function asBody(value: unknown): ApiErrorBody | undefined {
  return value && typeof value === 'object' ? (value as ApiErrorBody) : undefined;
}

/** 响应体里的 `message` 可能是字符串，也可能是 class-validator 的字符串数组。 */
function messageFromBody(body: ApiErrorBody | undefined): string | undefined {
  if (!body) return undefined;
  if (Array.isArray(body.message)) {
    const joined = body.message.map(String).filter(Boolean).join('；');
    return joined || undefined;
  }
  if (typeof body.message === 'string' && body.message.trim()) return body.message;
  return undefined;
}

/** 从 axios 异常里取出可展示文案：优先错误码覆盖，其次后端 message。 */
export function parseApiError(error: unknown, fallback = '操作失败，请稍后重试'): ParsedApiError {
  const response = (error as { response?: { status?: number; data?: unknown } } | undefined)?.response;
  const body = asBody(response?.data);

  if (!response) {
    // 请求被取消不算失败，交给调用方判断（这里仍返回结构化结果，不弹提示）
    return {
      code: body?.code,
      message: (error as { code?: string })?.code === 'ERR_CANCELED' ? '请求已取消' : NETWORK_ERROR_MESSAGE,
      status: undefined,
      details: body?.details,
      requestId: body?.requestId,
      raw: error,
    };
  }

  const code = typeof body?.code === 'string' ? body.code : undefined;
  const codeMessage = code && code in CODE_MESSAGES ? CODE_MESSAGES[code as ErrorCodeName] : undefined;
  const detailsMessage =
    Array.isArray(body?.details) && body.details.length > 0 ? body.details.map(String).join('；') : undefined;
  const bodyMessage = messageFromBody(body);

  return {
    code,
    // 错误码文案优先：后端 message 可能包含实现细节（SQL、字段名）或随时间改动。
    // 校验错误优先展示字段级 details（比「请求参数验证失败」更有用）。
    message:
      (code === 'COMMON_VALIDATION_ERROR' ? detailsMessage : undefined) ??
      codeMessage ??
      bodyMessage ??
      fallback,
    status: response.status,
    details: body?.details,
    requestId: body?.requestId,
    raw: error,
  };
}

/** 是否为「并发刷新竞态」：客户端应短暂等待后用新 cookie 重试一次。 */
export function isRefreshRotationRace(error: unknown): boolean {
  return parseApiError(error).code === 'AUTH_REFRESH_ROTATING';
}

/** 是否为用户主动取消（例如切换页面中止请求），不应弹错误提示。 */
export function isCanceled(error: unknown): boolean {
  return (error as { code?: string } | undefined)?.code === 'ERR_CANCELED';
}

/**
 * 展示用文案：`fallback` 是本页面的语气（例如「删除失败」），
 * 后端给了明确原因时仍优先展示原因。
 */
export function apiErrorMessage(error: unknown, fallback?: string): string {
  return parseApiError(error, fallback).message;
}
