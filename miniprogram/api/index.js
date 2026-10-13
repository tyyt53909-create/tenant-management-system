import request from '../utils/request.js'
import { API_BASE_URL } from '../utils/api-config.js'

// 用户登录
export const login = (data) => {
  return request.post('/auth/login', data)
}

// 获取我的合同
export const getMyContracts = () => {
  return request.get('/contracts/my')
}

// 获取我的账单
export const getMyBills = (params) => {
  return request.get('/bills/my', params)
}

// 获取账单详情
export const getBillDetail = (id) => {
  return request.get(`/bills/${id}`)
}

// 获取我的报修记录
export const getMyMaintenance = (params) => {
  return request.get('/maintenance/my', params)
}

// 创建报修
export const createMaintenance = (data) => {
  return request.post('/maintenance', data)
}

/**
 * 上传单张报修照片（multipart/form-data，字段名 file）。
 * 返回 { key, url, fileName, fileSize, mimeType }；url 形如 /api/files/<key>，
 * 提交报修时把 url 放入 photos 数组。
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
        } catch (error) {
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

// 获取我的账户余额
export const getMyAccount = () => {
  return request.get('/prepay-accounts/my')
}

// 获取充值记录
export const getRechargeRecords = (params) => {
  return request.get('/prepay-accounts/transactions', params)
}

// 获取用户信息
export const getUserInfo = () => {
  return request.get('/auth/me')
}

// 列表范围由服务端按 CLEANER 角色限制，不依赖客户端筛选权限。
export const getCleaningRooms = (params) => request.get('/rooms', params)
export const startCleaning = (id, version) => request.patch(
  `/rooms/${encodeURIComponent(id)}/status`, { cleanStatus: 'CLEANING', version }
)
export const completeCleaning = (id, version) => request.patch(
  `/rooms/${encodeURIComponent(id)}/clean`, { version }
)

/**
 * 通知（T163）
 *
 * 服务端全部按 req.user.userId 硬过滤，不信任客户端传参；
 * 操作他人通知会被后端拒绝（403）。租客与保洁共用同一组接口。
 */
export const getNotifications = (params) => request.get('/notifications', params)
export const getUnreadCount = () => request.get('/notifications/unread-count')
export const markNotificationRead = (id) =>
  request.patch(`/notifications/${encodeURIComponent(id)}/read`)
export const markAllNotificationsRead = () => request.patch('/notifications/read-all')
export const deleteNotification = (id) =>
  request.delete(`/notifications/${encodeURIComponent(id)}`)
