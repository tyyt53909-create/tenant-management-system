import { getUserInfo } from '../api/index.js'

export const CLEANER_PAGE = '/pages/cleaning/cleaning'

export function openHome(role) {
  if (role === 'CLEANER') uni.reLaunch({ url: CLEANER_PAGE })
  else uni.switchTab({ url: '/pages/index/index' })
}

export function clearSession() {
  for (const key of ['access_token', 'refresh_token', 'user_role']) {
    uni.removeStorageSync(key)
  }
}

// 旧会话没有缓存角色时也向服务器确认，不把保洁误当作租客。
export async function ensureTenantSession() {
  if (!uni.getStorageSync('access_token')) {
    uni.reLaunch({ url: '/pages/login/login' })
    return false
  }
  const user = await getUserInfo()
  uni.setStorageSync('user_role', user.role)
  if (user.role === 'CLEANER') {
    openHome(user.role)
    return false
  }
  return true
}
