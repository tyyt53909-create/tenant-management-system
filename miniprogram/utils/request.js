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
          const message = Array.isArray(res.data?.message)
            ? res.data.message.join('；') : res.data?.message || '请求失败'
          uni.showToast({
            title: message,
            icon: 'none'
          })
          const error = new Error(message)
          error.statusCode = res.statusCode
          reject(error)
        }
      },
      fail: (err) => {
        uni.showToast({
          title: '网络错误',
          icon: 'none'
        })
        reject(err)
      }
    })
  })
}

// 导出请求方法
export default {
  get: (url, data) => request({ url, method: 'GET', data }),
  post: (url, data) => request({ url, method: 'POST', data }),
  put: (url, data) => request({ url, method: 'PUT', data }),
  patch: (url, data) => request({ url, method: 'PATCH', data }),
  delete: (url, data) => request({ url, method: 'DELETE', data })
}
