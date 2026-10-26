import request from '../utils/request.js'

/**
 * @typedef {Object} ContractItem
 * @property {string} id
 * @property {string} contractNumber
 * @property {string} roomId
 * @property {string} status
 * @property {string} signStatus
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

/**
 * 获取租约合同详情
 * @param {string} id
 */
export const getContractDetail = (id) => {
  return request.get(`/contracts/${id}`)
}

/**
 * 查询合同电子签约状态与各方签署进度
 * @param {string} id
 */
export const getContractSignStatus = (id) => {
  return request.get(`/contracts/${id}/sign/status`)
}

/**
 * 获取合同规范 PDF 预览与下载地址
 * @param {string} id
 */
export const getContractPdfUrl = (id) => {
  return `/api/contracts/${id}/pdf`
}

/**
 * 获取系统默认标准租赁合同模板
 */
export const getDefaultContractTemplate = () => {
  return request.get('/contract-templates/default')
}

/**
 * 模拟完成合同签署（测试/沙箱环境）
 * @param {string} id
 */
export const mockCompleteContractSign = (id) => {
  return request.post(`/contracts/${id}/sign/mock-complete`)
}
