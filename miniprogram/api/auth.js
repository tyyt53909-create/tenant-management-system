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
 * 发送邮箱验证码 (OTP)
 * @param {{ email: string }} data
 * @returns {Promise<{ message: string, cooldown?: number }>}
 */
export const sendEmailCode = (data) => {
  return request.post('/auth/send-email-code', data)
}

/**
 * 邮箱验证码登录（首次登录必须携带邀请码，DEC-03 不再自动注册）
 * @param {{ email: string, code: string, inviteCode?: string }} data
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
 * 获取微信小程序配置
 * @returns {Promise<{ appId: string, mockEnabled: boolean }>}
 */
export const getWechatConfig = () => {
  return request.get('/auth/wechat/config')
}

/**
 * 微信一键登录
 * @param {{ code: string }} data
 * @returns {Promise<LoginResponse>}
 */
export const loginWithWechat = (data) => {
  return request.post('/auth/wechat/login', data)
}

/**
 * 微信绑定身份
 * @param {{ bindTicket: string, inviteCode?: string, phoneCode?: string }} data
 * @returns {Promise<LoginResponse>}
 */
export const bindWechat = (data) => {
  return request.post('/auth/wechat/bind', data)
}

/**
 * 获取当前登录用户信息
 * @returns {Promise<{ id: string, email: string, phone?: string, role: string, tenant?: any }>}
 */
/**
 * 当前登录用户（含角色与租客能力列表，FE-02 / T287 类型化）
 * @returns {Promise<{
 *   id: string, email: string, phone?: string|null, role: string,
 *   capabilities?: string[],
 *   tenant?: { id: string, name: string } | null
 * }>}
 */
export const getUserInfo = () => {
  return request.get('/auth/me')
}
