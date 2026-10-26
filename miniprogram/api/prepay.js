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

/**
 * 发起预付线上充值微信支付 JSAPI 下单 (PAY-04 / T296)
 * @param {number} amount 充值金额（单位：分）
 * @returns {Promise<{ appId: string, timeStamp: string, nonceStr: string, package: string, signType: string, paySign: string, outTradeNo: string }>}
 */
export const createPrepayJsapiPay = (amount) => {
  return request.post('/prepay-accounts/my/recharge/wechat-jsapi', { amount })
}

/**
 * 主动查询预付充值支付结果 (PAY-04 / T296)
 * @param {string} outTradeNo 微信商户订单号
 * @returns {Promise<{ status: string, amount?: number, account?: any, transaction?: any }>}
 */
export const queryPrepayPay = (outTradeNo) => {
  return request.post('/prepay-accounts/my/recharge/wechat-query', { outTradeNo })
}
