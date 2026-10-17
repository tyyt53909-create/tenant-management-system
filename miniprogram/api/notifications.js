import request from '../utils/request.js'

/**
 * 获取站内通知列表（按 req.user.userId 过滤）
 * @param {{ page?: number, limit?: number, isRead?: boolean }} [params]
 * @returns {Promise<any>}
 */
export const getNotifications = (params) => request.get('/notifications', params)

/**
 * 获取未读通知数量
 * @returns {Promise<{ count: number }>}
 */
export const getUnreadCount = () => request.get('/notifications/unread-count')

/**
 * 标记单条通知为已读
 * @param {string} id
 * @returns {Promise<any>}
 */
export const markNotificationRead = (id) =>
  request.patch(`/notifications/${encodeURIComponent(id)}/read`)

/**
 * 标记所有通知为已读
 * @returns {Promise<any>}
 */
export const markAllNotificationsRead = () => request.patch('/notifications/read-all')

/**
 * 删除通知
 * @param {string} id
 * @returns {Promise<any>}
 */
export const deleteNotification = (id) =>
  request.delete(`/notifications/${encodeURIComponent(id)}`)
