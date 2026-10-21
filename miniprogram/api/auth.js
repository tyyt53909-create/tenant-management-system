import request from '../utils/request.js'

/**
 * @typedef {Object} LoginPayload
 * @property {string} identifier - 邮箱或手机号
 * @property {string} password - 密码
 *
 * @typedef {Object} LoginResponse
 * @property {string} accessToken
 * @property {string} refreshToken
 * @property {{ id: string, email: string, role: string }} user
 */

/**
 * 用户登录（密码模式）
 * @param {LoginPayload} data
 * @returns {Promise<LoginResponse>}
 */
export const login = (data) => {
  return request.post('/auth/login', data)
}

/**
 * 员工激活（保洁/维修）：用管理员发放的角色邀请码注册并登录
 * @param {{ email: string, password: string, inviteCode: string, phone?: string }} data
 * @returns {Promise<LoginResponse>}
 */
export const register = (data) => {
  return request.post('/auth/register', data)
}

/**
 * 发送邮箱验证码 (OTP)
 * @param {{ email: string }} data
 * @returns {Promise<{ message: string, cooldown?: number }>}
 */
export const sendEmailCode = (data) => {
  return request.post('/auth/send-email-code', data)
}

/**
 * 邮箱验证码登录 / 自动注册
 * @param {{ email: string, code: string }} data
 * @returns {Promise<LoginResponse & { isNewUser: boolean }>}
 */
export const loginWithEmailCode = (data) => {
  return request.post('/auth/login-email-code', data)
}

/**
 * 绑定/兑换房源邀请码
 * @param {{ inviteCode: string }} data
 * @returns {Promise<{ message: string, tenantId?: string, roomId?: string }>}
 */
export const bindInviteCode = (data) => {
  return request.post('/auth/bind-invite-code', data)
}

/**
 * 获取 Google Client ID 配置
 * @returns {Promise<{ clientId: string }>}
 */
export const getGoogleClientId = () => {
  return request.get('/auth/google/client-id')
}

/**
 * Google 统一身份认证登录
 * @param {{ idToken: string, inviteCode?: string }} data
 * @returns {Promise<LoginResponse & { isNewUser: boolean }>}
 */
export const loginWithGoogle = (data) => {
  return request.post('/auth/google', data)
}

/**
 * 获取当前登录用户信息
 * @returns {Promise<{ id: string, email: string, phone?: string, role: string, tenant?: any }>}
 */
export const getUserInfo = () => {
  return request.get('/auth/me')
}
