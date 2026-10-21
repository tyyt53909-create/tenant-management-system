import { getUserInfo } from '../api/index.js'
import { API_BASE_URL } from './api-config.js'

export const CLEANER_PAGE = '/pages/cleaning/cleaning'
export const MAINTENANCE_PAGE = '/pages/maintenance/home'

export function openHome(role) {
  if (role === 'CLEANER') uni.reLaunch({ url: CLEANER_PAGE })
  else if (role === 'MAINTENANCE') uni.reLaunch({ url: MAINTENANCE_PAGE })
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

// 任意已登录角色（租客/保洁/维修/管理员）都可用的会话确认。
export async function ensureSession() {
  if (!uni.getStorageSync('access_token')) {
    uni.reLaunch({ url: '/pages/login/login' })
    return false
  }
  const user = await getUserInfo()
  uni.setStorageSync('user_role', user.role)
  if (Array.isArray(user.capabilities)) {
    uni.setStorageSync('user_capabilities', user.capabilities)
  }
  return user
}

// 租客页面专用：保洁/维修会被送回各自的工作台，避免误入租客页面。
export async function ensureTenantSession() {
  const user = await ensureSession()
  if (!user) return false
  if (user.role === 'CLEANER' || user.role === 'MAINTENANCE') {
    openHome(user.role)
    return false
  }
  return true
}
