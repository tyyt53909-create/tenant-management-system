import { ElMessage } from 'element-plus';
import { apiErrorMessage, isCanceled, NETWORK_ERROR_MESSAGE } from './apiError';

/**
 * 统一的错误提示入口（COM-05 / T285）。
 *
 * 背景：请求层拦截器已经会为非 `silentError` 的请求弹一次错误提示，
 * 各页面又在 catch 里再弹一次「删除失败」——用户会连续看到两条自相矛盾的消息，
 * 而且泛化文案会把后端给出的具体原因盖掉。
 *
 * 规则：
 * - 请求层已提示过的错误（同一个 error 对象）不重复提示；
 * - 用户主动取消（切换页面中止请求）不提示；
 * - 其它情况（本地校验、上传组件回调等）按统一解析提示，保留页面语气作为兜底。
 */
const notified = new WeakSet<object>();

/** 由请求层拦截器在弹过提示后调用，标记该异常已被处理。 */
export function markApiErrorNotified(error: unknown): void {
  if (error && typeof error === 'object') notified.add(error as object);
}

export function wasApiErrorNotified(error: unknown): boolean {
  return !!error && typeof error === 'object' && notified.has(error as object);
}

/** 提示错误；已提示/已取消时静默返回 false。 */
export function notifyApiError(error: unknown, fallback?: string): boolean {
  if (isCanceled(error) || wasApiErrorNotified(error)) return false;
  ElMessage.error(apiErrorMessage(error, fallback));
  markApiErrorNotified(error);
  return true;
}

/** 本地错误（非请求异常，例如文件类型不符）直接提示。 */
export function notifyLocalError(message: string): void {
  ElMessage.error(message || NETWORK_ERROR_MESSAGE);
}
