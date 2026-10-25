import request from '../utils/request.js'

/**
 * 查询可租房源列表（免登录）
 * @param {{ page?: number, limit?: number, buildingId?: string, floor?: number, roomType?: string, minPrice?: number, maxPrice?: number }} [params]
 */
export const getPublicRooms = (params) => {
  return request.get('/public/rooms', params)
}

/**
 * 查询房源详情（免登录）
 * @param {string} id - 房源 ID
 */
export const getPublicRoomDetail = (id) => {
  return request.get(`/public/rooms/${id}`)
}

/**
 * 获取房源标准化分享卡片与海报数据（免登录）
 * @param {string} id - 房源 ID
 */
export const getRoomShareInfo = (id) => {
  return request.get(`/public/rooms/${id}/share`)
}

/**
 * 提交找房意向留资（免登录）
 * @param {{ name: string, phone: string, roomType?: string, budgetMin?: number, budgetMax?: number, expectedMoveIn?: string, source?: string, roomId?: string, notes?: string }} data
 */
export const submitPublicLead = (data) => {
  return request.post('/public/leads', data)
}

/**
 * 发起预约看房（免登录或携带用户 Token）
 * @param {{ roomId: string, name: string, phone: string, appointmentTime: string, visitorsCount?: number, notes?: string }} data
 */
export const submitPublicAppointment = (data) => {
  return request.post('/public/appointments', data)
}

/**
 * 查询我的看房预约记录（租客端登录后）
 */
export const getMyAppointments = () => {
  return request.get('/appointments/my')
}

/**
 * 取消看房预约（租客/管理员）
 * @param {string} id - 预约 ID
 * @param {string} [reason] - 取消原因
 */
export const cancelAppointment = (id, reason) => {
  return request.patch(`/appointments/${id}/cancel`, { reason })
}
