import { API_BASE_URL } from './api-config.js'

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
          if (res.statusCode >= 200 && res.statusCode < 300 && res.data && res.data.accessToken) {
            uni.setStorageSync('access_token', res.data.accessToken)
            if (res.data.refreshToken) uni.setStorageSync('refresh_token', res.data.refreshToken)
            resolve(res.data.accessToken)
            return
          }
          const error = new Error((res.data && res.data.message) || '登录已过期')
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
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data)
        } else if (res.statusCode === 401) {
          if (options.url === '/auth/login') {
            const message = res.data?.message || '账号或密码不正确'
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
          const message = errorText(res.data)
          uni.showToast({
            title: message,
            icon: 'none'
          })
          const error = new Error(message)
          error.statusCode = res.statusCode
          error.code = errorCode(res.data)
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
        const error = new Error(message)
        error.isNetworkError = true
        reject(error)
      }
    })
  })
}

function errorText(data) {
  if (!data) return '请求失败，请稍后重试'
  const code = data.code || ''
  if (code === 'CAPABILITY_DENIED' || data.message === 'CAPABILITY_DENIED') return '当前账号的这项功能已暂停'
  if (code === 'COMMON_RATE_LIMIT_EXCEEDED') return '请求过于频繁，请稍后再试'
  if (code === 'COMMON_INTERNAL_ERROR') return '服务器内部错误，请稍后重试'
  if (code === 'AUTH_INVALID_CREDENTIALS') return '账号或密码不正确'
  if (code === 'AUTH_TOKEN_EXPIRED' || code === 'AUTH_TOKEN_INVALID') return '登录已失效，请重新登录'
  if (code === 'AUTH_INVITE_CODE_INVALID') return '邀请码无效或已使用'
  if (code === 'AUTH_INVITE_CODE_EXPIRED') return '邀请码已过期'
  if (code === 'AUTH_EMAIL_ALREADY_EXISTS') return '该邮箱已被注册'
  if (code === 'PERM_FORBIDDEN' || code === 'PERM_INSUFFICIENT_ROLE') return '您没有权限执行此操作'
  if (code === 'PERM_BUILDING_ACCESS_DENIED') return '无权访问该楼栋数据'
  if (code === 'ROOM_VERSION_CONFLICT') return '房态信息已被他人更新，请刷新重试'
  if (code === 'ROOM_NOT_AVAILABLE') return '房源当前状态不允许此操作'
  if (code === 'BILL_ALREADY_PAID') return '该账单已完成缴费，无需重复操作'
  if (code === 'BILL_PAYMENT_EXCEEDS_AMOUNT') return '支付金额不能超过账单待缴金额'
  if (code === 'PREPAY_INSUFFICIENT_BALANCE') return '预付账户余额不足，请先充值'
  if (code === 'PREPAY_INVALID_AMOUNT') return '操作金额不正确'
  if (code === 'COMMON_CONFLICT') return '数据已存在或已被修改，请刷新后重试'
  if (code === 'COMMON_RESOURCE_NOT_FOUND') return '请求的资源不存在'
  if (code === 'COMMON_VALIDATION_ERROR' && Array.isArray(data.details)) return data.details.join('；')
  if (Array.isArray(data.message)) return data.message.join('；')
  return (typeof data.message === 'string' && data.message) ? data.message : '请求失败'
}

function errorCode(data) {
  if (data?.code) return data.code
  if (data?.message === 'CAPABILITY_DENIED') return 'CAPABILITY_DENIED'
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
