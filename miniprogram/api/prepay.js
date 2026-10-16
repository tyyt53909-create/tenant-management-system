import request from '../utils/request.js'

/**
 * @typedef {Object} PrepayAccount
 * @property {string} id
 * @property {string} tenantId
 * @property {number} balance
 * @property {string} status
 */

/**
 * 获取我的预付账户余额
 * @returns {Promise<PrepayAccount>}
 */
export const getMyAccount = () => {
  return request.get('/prepay-accounts/my')
}

/**
 * 获取账户充值/扣费流水记录
 * @param {{ page?: number, limit?: number, type?: string }} [params]
 * @returns {Promise<any>}
 */
export const getRechargeRecords = (params) => {
  return request.get('/prepay-accounts/transactions', params)
}
