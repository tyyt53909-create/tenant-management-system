import request from '../utils/request.js'

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
