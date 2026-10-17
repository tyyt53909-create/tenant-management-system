import { API_BASE_URL } from './api-config.js'

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
            uni.removeStorageSync('access_token')
            uni.removeStorageSync('refresh_token')
            uni.removeStorageSync('user_role')
            uni.reLaunch({ url: '/pages/login/login' })
            reject(new Error('登录已过期'))
            return
          }
          uni.request({
            url: API_BASE_URL + '/auth/refresh',
            method: 'POST',
            timeout: 15000,
            data: { refreshToken },
            header: { 'Content-Type': 'application/json' },
            success: (refreshRes) => {
              const nextAccess = refreshRes.data?.accessToken
              const nextRefresh = refreshRes.data?.refreshToken
              if (refreshRes.statusCode < 200 || refreshRes.statusCode >= 300 || !nextAccess) {
                uni.removeStorageSync('access_token')
                uni.removeStorageSync('refresh_token')
                uni.removeStorageSync('user_role')
                uni.reLaunch({ url: '/pages/login/login' })
                reject(new Error('登录已过期'))
                return
              }
              uni.setStorageSync('access_token', nextAccess)
              if (nextRefresh) uni.setStorageSync('refresh_token', nextRefresh)
              request({ ...options, _authRetried: true }).then(resolve, reject)
            },
            fail: () => {
              uni.removeStorageSync('access_token')
              uni.removeStorageSync('refresh_token')
              uni.removeStorageSync('user_role')
              uni.reLaunch({ url: '/pages/login/login' })
              reject(new Error('登录已过期'))
            },
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
