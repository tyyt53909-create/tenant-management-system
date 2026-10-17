import request from '../utils/request.js'

/**
 * @typedef {Object} ContractItem
 * @property {string} id
 * @property {string} contractNumber
 * @property {string} roomId
 * @property {string} status
 * @property {string} startDate
 * @property {string} endDate
 * @property {number} rentAmount
 * @property {number} depositAmount
 */

/**
 * 获取我的租约合同列表
 * @returns {Promise<ContractItem[]>}
 */
export const getMyContracts = () => {
  return request.get('/contracts/my')
}
