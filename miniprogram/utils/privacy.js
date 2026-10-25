/**
 * 小程序隐私授权（FE-02 / T287）。
 *
 * 微信要求：调用 `chooseImage` / `saveImageToPhotosAlbum` / `setClipboardData`
 * 等隐私接口前，必须先让用户同意《隐私保护指引》。`uni.onNeedPrivacyAuthorization`
 * 会在需要时回调，由我们展示说明并调用 `resolve`。
 *
 * 设计：
 * - 纯函数 `privacySummary()` 生成要展示的条目，便于单测与文案统一；
 * - `installPrivacyHandler()` 在 App.onLaunch 注册一次；
 * - `withPrivacy()` 包裹隐私调用，未同意时自动弹窗，拒绝则静默返回 null。
 */

/** 本项目实际使用的隐私接口与用途（与小程序后台《隐私保护指引》保持一致）。 */
export const PRIVACY_ITEMS = [
  { api: 'chooseImage', label: '相册/相机', purpose: '上传报修照片，仅用于维修人员判断问题' },
  { api: 'setClipboardData', label: '剪贴板', purpose: '复制账单号、管家微信或电话，方便你粘贴给他人' },
  { api: 'saveImageToPhotosAlbum', label: '保存到相册', purpose: '保存缴费凭单图片，作为线下凭证' },
]

/** 弹窗标题与正文（纯函数，测试可直接断言文案）。 */
export function privacySummary(items = PRIVACY_ITEMS) {
  return {
    title: '隐私保护提示',
    content:
      '为了完成你正在使用的功能，栖居需要访问以下信息：\n' +
      items.map((item) => `· ${item.label}：${item.purpose}`).join('\n') +
      '\n\n我们不会把这些信息用于其他目的，也不会提供给无关第三方。',
    confirmText: '同意并继续',
    cancelText: '暂不使用',
  }
}

/**
 * 在 App 启动时注册隐私授权回调。
 *
 * `uni.onNeedPrivacyAuthorization` 在部分平台（H5 / 低版本基础库）不存在；
 * 此时不注册，直接让基础库按旧行为处理。
 *
 * @param {(result: { event: string, resolve: (payload: { event: string, buttonId?: string }) => void }) => void} [show]
 *   展示方式，默认使用 `uni.showModal`
 */
export function installPrivacyHandler(show) {
  if (typeof uni === 'undefined') return false
  // `@dcloudio/types` 尚未收录该 API（微信基础库 2.32+）；按官方签名局部断言，
  // 运行时仍用 typeof 判空，H5/低版本基础库会直接跳过。
  const register = /** @type {((listener: (resolve: (payload: { event: string, buttonId?: string }) => void) => void) => void) | undefined} */ (
    /** @type {any} */ (uni).onNeedPrivacyAuthorization
  )
  if (typeof register !== 'function') return false
  register((resolve) => {
    const summary = privacySummary()
    const display =
      show ||
      (({ event, resolve: done }) => {
        uni.showModal({
          title: summary.title,
          content: summary.content,
          confirmText: summary.confirmText,
          cancelText: summary.cancelText,
          success: (res) => {
            done({ event: res.confirm ? 'agree' : 'disagree' })
          },
          fail: () => done({ event: 'disagree' }),
        })
      })
    display({ event: 'needPrivacyAuthorization', resolve })
  })
  return true
}

/**
 * 包裹隐私接口调用：拒绝授权时返回 null，由调用方决定是否提示。
 *
 * @template T
 * @param {() => Promise<T>} action
 * @returns {Promise<T|null>}
 */
export async function withPrivacy(action) {
  try {
    return await action()
  } catch (error) {
    const message = (error && (error.errMsg || error.message)) || ''
    if (message.includes('privacy') || message.includes('cancel')) {
      // 用户拒绝或取消：不弹二次错误，让页面保持原状
      return null
    }
    throw error
  }
}
