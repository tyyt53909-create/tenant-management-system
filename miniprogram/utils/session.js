import { getUserInfo } from '../api/index.js'
import { API_BASE_URL } from './api-config.js'

export const CLEANER_PAGE = '/pages/cleaning/cleaning'

export function openHome(role) {
  if (role === 'CLEANER') uni.reLaunch({ url: CLEANER_PAGE })
  else uni.switchTab({ url: '/pages/index/index' })
}

export function clearSession() {
  for (const key of ['access_token', 'refresh_token', 'user_role', 'user_capabilities']) {
    uni.removeStorageSync(key)
  }
}

export function logoutSession() {
  const refreshToken = uni.getStorageSync('refresh_token')
  clearSession()
  if (!refreshToken) return
  uni.request({
    url: API_BASE_URL + '/auth/logout',
    method: 'POST',
    timeout: 15000,
    data: { refreshToken },
    header: { 'Content-Type': 'application/json' },
    success() {},
    fail() {},
  })
}

// 只相信 /auth/me 写入的能力数组。没有缓存或载入失败时不把功能当成允许。
export function hasCapability(code) {
  const caps = uni.getStorageSync('user_capabilities')
  if (!Array.isArray(caps)) return false
  return caps.includes(code)
}

// 旧会话没有缓存角色时也向服务器确认，不把保洁误当作租客。
export async function ensureTenantSession() {
  if (!uni.getStorageSync('access_token')) {
    uni.reLaunch({ url: '/pages/login/login' })
    return false
  }
  const user = await getUserInfo()
  uni.setStorageSync('user_role', user.role)
  if (Array.isArray(user.capabilities)) {
    uni.setStorageSync('user_capabilities', user.capabilities)
  }
  if (user.role === 'CLEANER') {
    openHome(user.role)
    return false
  }
  return true
}
