import request from '../utils/request.js'

/**
 * 获取我的房屋验房单列表（入住/退租）
 * @param {Object} [query]
 */
export const getMyInspections = (query) => {
  return request.get('/inspections/my', query)
}

/**
 * 获取验房单详情
 * @param {string} id
 */
export const getInspectionDetail = (id) => {
  return request.get(`/inspections/${id}`)
}

/**
 * 租客在线确认或驳回验房单
 * @param {string} id
 * @param {Object} data
 * @param {boolean} [data.agree]
 * @param {string} [data.tenantSignature]
 * @param {string} [data.tenantNotes]
 */
export const confirmInspection = (id, data) => {
  return request.post(`/inspections/${id}/confirm`, data)
}
