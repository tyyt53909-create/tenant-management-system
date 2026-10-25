import { API_BASE_URL } from './api-config.js'
// 错误码常量（QLT-04 / T289 三端共享）；小程序比较错误码时禁止手抄字符串
import { ErrorCode } from '../../shared/src/error-codes.ts'

/**
 * 带后端字段的请求错误（FE-02 / T287 类型化）。
 * 之前直接给 `Error` 挂 `statusCode` / `code` / `isNetworkError`，checkJs 无法识别。
 * @typedef {Error & { statusCode?: number, code?: string, isNetworkError?: boolean }} RequestError
 */

/**
 * @param {string} message
 * @returns {RequestError}
 */
function requestError(message) {
  return new Error(message)
}

/**
 * `uni.request` 的 `res.data` 类型是 string | AnyObject | ArrayBuffer；
 * 后端始终返回 JSON，这里统一收敛成对象，避免每个调用点各自断言。
 * @param {unknown} data
 * @returns {Record<string, any>}
 */
function asObject(data) {
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
}

// 并发 401 共用同一次刷新（T208）：首屏多个请求同时 401 时各自发一次刷新，会互相把对方的
// refresh token 轮换掉。后端对同一 token 只让一个赢，输的那个若直接清空存储，会把赢家刚
// 写入的新令牌一并清掉 → 用户被强制登出。这里让同一运行时的并发刷新共用一次请求。
let refreshPromise = null

function clearSessionAndRedirect() {
  uni.removeStorageSync('access_token')
  uni.removeStorageSync('refresh_token')
  uni.removeStorageSync('user_role')
  uni.reLaunch({ url: '/pages/login/login' })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 后端对同一 refresh token 只允许一个请求轮换成功，输的那个在宽限窗口内会拿到
 * 「刷新令牌正在轮换中」——这是并发竞态，不是令牌失效（T208）。
 */
function isRotationRace(error) {
  const code = error && /** @type {RequestError} */ (error).code
  if (code === ErrorCode.AUTH_REFRESH_ROTATING) return true
  const message = error && error.message
  return typeof message === 'string' && message.includes('正在轮换中')
}

/** 刷新令牌；同一运行时的并发调用共用同一个 promise。 */
function refreshTokens() {
  if (!refreshPromise) {
    const base = new Promise((resolve, reject) => {
      const refreshToken = uni.getStorageSync('refresh_token')
      if (!refreshToken) {
        reject(new Error('登录已过期'))
        return
      }
      uni.request({
        url: API_BASE_URL + '/auth/refresh',
        method: 'POST',
        timeout: 15000,
        data: { refreshToken },
        header: { 'Content-Type': 'application/json' },
        success: (res) => {
          const body = asObject(res.data)
          if (res.statusCode >= 200 && res.statusCode < 300 && body.accessToken) {
            uni.setStorageSync('access_token', body.accessToken)
            if (body.refreshToken) uni.setStorageSync('refresh_token', body.refreshToken)
            resolve(body.accessToken)
            return
          }
          const error = /** @type {RequestError} */ (requestError(body.message || '登录已过期'))
          error.statusCode = res.statusCode
          reject(error)
        },
        fail: () => reject(new Error('刷新请求失败')),
      })
    })
    refreshPromise = base.finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

// 请求拦截器
const request = (options) => {
  return new Promise((resolve, reject) => {
    // 获取 token
    const token = uni.getStorageSync('access_token')

    uni.request({
      url: API_BASE_URL + options.url,
      method: options.method || 'GET',
      timeout: 15000,
      data: options.data || {},
      header: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      success: (res) => {
        const body = asObject(res.data)
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data)
        } else if (res.statusCode === 401) {
          if (options.url === '/auth/login') {
            const message = body.message || '账号或密码不正确'
            uni.showToast({ title: message, icon: 'none' })
            reject(new Error(message))
            return
          }
          const refreshToken = uni.getStorageSync('refresh_token')
          const path = (options.url || '').split('?')[0]
          const canRefresh = refreshToken && !options._authRetried && !/\/auth\/(login|register|refresh)$/.test(path)
          if (!canRefresh) {
            clearSessionAndRedirect()
            reject(new Error('登录已过期'))
            return
          }
          refreshTokens()
            .then(() => request({ ...options, _authRetried: true }).then(resolve, reject))
            .catch(async (error) => {
              // H5 多标签等跨运行时的并发轮换：赢家已把新令牌写入共享存储，
              // 稍等后用新令牌重试一次，不要把整份会话清掉（T208）
              if (isRotationRace(error) && !options._authRetried) {
                await sleep(300)
                const latest = uni.getStorageSync('access_token')
                if (latest && latest !== token) {
                  request({ ...options, _authRetried: true }).then(resolve, reject)
                  return
                }
              }
              clearSessionAndRedirect()
              reject(new Error('登录已过期'))
            })
        } else {
          const message = errorText(body)
          uni.showToast({
            title: message,
            icon: 'none'
          })
          const error = /** @type {RequestError} */ (requestError(message))
          error.statusCode = res.statusCode
          error.code = errorCode(body)
          reject(error)
        }
      },
      fail: (err) => {
        const isTimeout = Boolean(err && typeof err.errMsg === 'string' && err.errMsg.includes('timeout'))
        const message = isTimeout ? '网络请求超时，请检查网络后重试' : '网络连接失败，请检查网络设置'
        uni.showToast({
          title: message,
          icon: 'none',
          duration: 2500,
        })
        const error = /** @type {RequestError} */ (requestError(message))
        error.isNetworkError = true
        reject(error)
      }
    })
  })
}

/**
 * @param {Record<string, any>} data
 * @returns {string}
 */
function errorText(data) {
  if (!data) return '请求失败，请稍后重试'
  const code = data.code || ''
  // 错误码常量来自共享包（QLT-04 / T289）；文案仍归小程序展示层
  if (code === ErrorCode.CAPABILITY_DENIED || data.message === ErrorCode.CAPABILITY_DENIED) return '当前账号的这项功能已暂停'
  if (code === ErrorCode.COMMON_RATE_LIMIT_EXCEEDED) return '请求过于频繁，请稍后再试'
  if (code === ErrorCode.COMMON_INTERNAL_ERROR) return '服务器内部错误，请稍后重试'
  if (code === ErrorCode.AUTH_INVALID_CREDENTIALS) return '账号或密码不正确'
  if (code === ErrorCode.AUTH_TOKEN_EXPIRED || code === ErrorCode.AUTH_TOKEN_INVALID) return '登录已失效，请重新登录'
  if (code === ErrorCode.AUTH_INVITE_CODE_INVALID) return '邀请码无效或已使用'
  if (code === ErrorCode.AUTH_INVITE_CODE_EXPIRED) return '邀请码已过期'
  if (code === ErrorCode.AUTH_EMAIL_ALREADY_EXISTS) return '该邮箱已被注册'
  if (code === ErrorCode.PERM_FORBIDDEN || code === ErrorCode.PERM_INSUFFICIENT_ROLE) return '您没有权限执行此操作'
  if (code === ErrorCode.PERM_BUILDING_ACCESS_DENIED) return '无权访问该楼栋数据'
  if (code === ErrorCode.ROOM_VERSION_CONFLICT) return '房态信息已被他人更新，请刷新重试'
  if (code === ErrorCode.ROOM_NOT_AVAILABLE) return '房源当前状态不允许此操作'
  if (code === ErrorCode.BILL_ALREADY_PAID) return '该账单已完成缴费，无需重复操作'
  if (code === ErrorCode.BILL_PAYMENT_EXCEEDS_AMOUNT) return '支付金额不能超过账单待缴金额'
  if (code === ErrorCode.PREPAY_INSUFFICIENT_BALANCE) return '预付账户余额不足，请先充值'
  if (code === ErrorCode.PREPAY_INVALID_AMOUNT) return '操作金额不正确'
  if (code === ErrorCode.COMMON_CONFLICT) return '数据已存在或已被修改，请刷新后重试'
  if (code === ErrorCode.COMMON_RESOURCE_NOT_FOUND) return '请求的资源不存在'
  if (code === ErrorCode.COMMON_VALIDATION_ERROR && Array.isArray(data.details)) return data.details.join('；')
  if (Array.isArray(data.message)) return data.message.join('；')
  return (typeof data.message === 'string' && data.message) ? data.message : '请求失败'
}

/**
 * @param {Record<string, any>} data
 * @returns {string}
 */
/**
 * @param {Record<string, any>} body
 * @returns {string}
 */
function errorCode(body) {
  if (body?.code) return body.code
  if (body?.message === 'CAPABILITY_DENIED') return 'CAPABILITY_DENIED'
  return ''
}

// 导出请求方法
export default {
  get: (url, data) => request({ url, method: 'GET', data }),
  post: (url, data) => request({ url, method: 'POST', data }),
  put: (url, data) => request({ url, method: 'PUT', data }),
  patch: (url, data) => request({ url, method: 'PATCH', data }),
  delete: (url, data) => request({ url, method: 'DELETE', data })
}
