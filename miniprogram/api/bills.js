import request from '../utils/request.js'

/**
 * @typedef {Object} BillQuery
 * @property {string} [status] - 账单状态 PENDING | PAID | OVERDUE
 * @property {number} [page]
 * @property {number} [limit]
 *
 * @typedef {Object} BillItem
 * @property {string} id
 * @property {string} billNumber
 * @property {string} billType
 * @property {number} amount
 * @property {number} paidAmount
 * @property {string} dueDate
 * @property {string} status
 */

/**
 * 获取我的账单列表
 * @param {BillQuery} [params]
 * @returns {Promise<BillItem[] | { data: BillItem[], meta: any }>}
 */
export const getMyBills = (params) => {
  return request.get('/bills/my', params)
}

/**
 * 获取账单详情
 * @param {string} id - 账单 ID
 * @returns {Promise<BillItem & { room?: any, payments?: any[], lateFees?: any[] }>}
 */
export const getBillDetail = (id) => {
  return request.get(`/bills/${id}`)
}
