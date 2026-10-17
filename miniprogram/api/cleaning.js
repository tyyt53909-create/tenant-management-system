import request from '../utils/request.js'

/**
 * 获取待保洁/保洁中房源列表（范围由服务端按 CLEANER 角色限制）
 * @param {{ status?: string, page?: number, limit?: number }} [params]
 * @returns {Promise<any>}
 */
export const getCleaningRooms = (params) => request.get('/rooms', params)

/**
 * 开始保洁（标记房源为 CLEANING）
 * @param {string} id - 房源 ID
 * @param {number} version - 乐观锁版本号
 * @returns {Promise<any>}
 */
export const startCleaning = (id, version) =>
  request.patch(`/rooms/${encodeURIComponent(id)}/status`, { cleanStatus: 'CLEANING', version })

/**
 * 完成保洁（房态恢复为 VACANT / CLEAN）
 * @param {string} id - 房源 ID
 * @param {number} version - 乐观锁版本号
 * @returns {Promise<any>}
 */
export const completeCleaning = (id, version) =>
  request.patch(`/rooms/${encodeURIComponent(id)}/clean`, { version })
