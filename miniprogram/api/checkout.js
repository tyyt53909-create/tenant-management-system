import request from '../utils/request.js'

/**
 * 租客发起退租申请
 * @param {Object} data
 * @param {string} data.contractId
 * @param {string} data.expectedCheckoutDate
 * @param {string} [data.reasonType]
 * @param {string} [data.reasonDetail]
 * @param {Object} [data.refundAccount]
 */
export const createCheckoutRequest = (data) => {
  return request.post('/checkout/requests', data)
}

/**
 * 获取我的退租申请列表
 * @param {Object} [query]
 */
export const getMyCheckoutRequests = (query) => {
  return request.get('/checkout/requests/my', query)
}

/**
 * 获取单条退租申请详情
 * @param {string} id
 */
export const getCheckoutRequestDetail = (id) => {
  return request.get(`/checkout/requests/${id}`)
}

/**
 * 撤回退租申请
 * @param {string} id
 */
export const cancelCheckoutRequest = (id) => {
  return request.post(`/checkout/requests/${id}/cancel`)
}

/**
 * 获取我的退租结算记录列表
 * @param {Object} [query]
 */
export const getMyCheckouts = (query) => {
  return request.get('/checkout', query)
}

/**
 * 获取退租结算记录详情
 * @param {string} id
 */
export const getCheckoutDetail = (id) => {
  return request.get(`/checkout/${id}`)
}

/**
 * 获取退租结算单据
 * @param {string} id
 */
export const getCheckoutVoucher = (id) => {
  return request.get(`/checkout/${id}/voucher`)
}
