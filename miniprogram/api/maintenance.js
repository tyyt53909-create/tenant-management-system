import request from '../utils/request.js'
import { API_BASE_URL } from '../utils/api-config.js'

/**
 * @typedef {Object} MaintenanceQuery
 * @property {string} [status] - PENDING | PROCESSING | COMPLETED | CANCELLED
 * @property {number} [page]
 * @property {number} [limit]
 *
 * @typedef {Object} CreateMaintenancePayload
 * @property {string} roomId
 * @property {string} title
 * @property {string} description
 * @property {string[]} [photos]
 */

/**
 * 获取我的报修工单记录
 * @param {MaintenanceQuery} [params]
 * @returns {Promise<any[]>}
 */
export const getMyMaintenance = (params) => {
  return request.get('/maintenance/my', params)
}

/**
 * 获取报修详情（服务端校验工单归属）
 * @param {string} id
 * @returns {Promise<any>}
 */
export const getMaintenanceDetail = (id) => request.get(`/maintenance/${encodeURIComponent(id)}`)

/**
 * 创建新报修工单
 * @param {CreateMaintenancePayload} data
 * @returns {Promise<any>}
 */
export const createMaintenance = (data) => {
  return request.post('/maintenance', data)
}

/**
 * 维修工作台工单列表（仅 MAINTENANCE）
 * @param {{ view?: 'pool'|'active'|'done', page?: number, limit?: number }} [params]
 * @returns {Promise<any>}
 */
export const getWorkbenchOrders = (params) => request.get('/maintenance/workbench', params)

/**
 * 维修工作台工单详情（仅公共池或本人已接工单）
 * @param {string} id
 * @returns {Promise<any>}
 */
export const getWorkbenchOrder = (id) => request.get(`/maintenance/workbench/${encodeURIComponent(id)}`)

/**
 * 接单（公共池先接先得）
 * @param {string} id
 * @returns {Promise<any>}
 */
export const claimMaintenance = (id) => request.patch(`/maintenance/${encodeURIComponent(id)}/claim`, {})

/**
 * 提交处理结果（IN_PROGRESS → PENDING_CONFIRM）
 * @param {string} id
 * @param {{ resolution: string }} data
 * @returns {Promise<any>}
 */
export const completeMaintenance = (id, data) =>
  request.patch(`/maintenance/${encodeURIComponent(id)}/complete`, data)

/**
 * 上传单张报修照片（multipart/form-data，字段名 file）
 * @param {string} filePath - 本地图片临时路径
 * @returns {Promise<{ key: string, url: string, fileName: string, fileSize: number, mimeType: string }>}
 */
export const uploadMaintenancePhoto = (filePath) => {
  return new Promise((resolve, reject) => {
    const token = uni.getStorageSync('access_token')
    uni.uploadFile({
      url: API_BASE_URL + '/files/upload',
      filePath,
      name: 'file',
      header: token ? { Authorization: `Bearer ${token}` } : {},
      success: (res) => {
        let data = res.data
        try {
          data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data
        } catch {
          reject(new Error('上传响应解析失败'))
          return
        }
        if (res.statusCode >= 200 && res.statusCode < 300 && data && data.url) {
          resolve(data)
        } else {
          reject(new Error((data && data.message) || `上传失败(${res.statusCode})`))
        }
      },
      fail: () => reject(new Error('上传失败，请检查网络')),
    })
  })
}
