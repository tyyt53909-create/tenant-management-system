import request from '../utils/request.js'

/**
 * 获取租客自助中心总览数据聚合看板（LSE-05 / T297）
 */
export const getMyOverview = () => {
  return request.get('/tenants/me/overview')
}

/**
 * 获取租客本人的实名认证与登记信息
 */
export const getMyRegistration = () => {
  return request.get('/tenants/me/registration')
}

/**
 * 租客自助提交实名认证登记信息
 * @param {{
 *   idType: 'ID_CARD' | 'PASSPORT' | 'OTHER',
 *   idNumber: string,
 *   realName?: string,
 *   emergencyContact?: string,
 *   emergencyPhone?: string
 * }} data
 */
export const submitMyRegistration = (data) => {
  return request.post('/tenants/me/registration', data)
}
