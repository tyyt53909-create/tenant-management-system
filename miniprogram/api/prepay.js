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
 * 微信支付 JSAPI 发起预付线上充值
 * @param {number} amount - 充值金额（单位：分）
 * @returns {Promise<any>} 微信支付调起参数
 */
export const rechargeWechatJsapi = (amount) => {
  return request.post('/prepay-accounts/my/recharge/wechat-jsapi', { amount })
}

/**
 * 微信支付充值状态主动查单
 * @param {string} outTradeNo - 充值商户单号
 * @returns {Promise<any>}
 */
export const queryRechargeStatus = (outTradeNo) => {
  return request.post('/prepay-accounts/my/recharge/wechat-query', { outTradeNo })
}

/**
 * 调起微信原生支付充值
 * @param {number} amount - 充值金额（分）
 * @returns {Promise<any>}
 */
export const requestPrepayPayment = async (amount) => {
  const payParams = await rechargeWechatJsapi(amount)
  return new Promise((resolve, reject) => {
    if (typeof uni === 'undefined' || !uni.requestPayment) {
      resolve({ mocked: true, ...payParams })
      return
    }
    uni.requestPayment({
      provider: 'wxpay',
      timeStamp: payParams.timeStamp,
      nonceStr: payParams.nonceStr,
      package: payParams.package,
      signType: payParams.signType,
      paySign: payParams.paySign,
      success: async () => {
        try {
          const syncRes = await queryRechargeStatus(payParams.outTradeNo)
          resolve(syncRes)
        } catch {
          resolve(payParams)
        }
      },
      fail: (err) => reject(err),
    })
  })
}
