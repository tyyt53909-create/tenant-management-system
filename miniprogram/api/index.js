/**
 * 微信小程序 API 聚合入口（OPT-21）
 *
 * 按领域拆分至独立子模块，本文件聚合导出，保持与既有调用点 100% 兼容。
 */

export * from './auth.js'
export * from './contracts.js'
export * from './bills.js'
export * from './maintenance.js'
export * from './prepay.js'
export * from './cleaning.js'
export * from './notifications.js'
export * from './tenants.js'
export * from './public.js'

// 亦支持领域命名空间导入
import * as auth from './auth.js'
import * as contracts from './contracts.js'
import * as bills from './bills.js'
import * as maintenance from './maintenance.js'
import * as prepay from './prepay.js'
import * as cleaning from './cleaning.js'
import * as notifications from './notifications.js'
import * as tenants from './tenants.js'
import * as publicApi from './public.js'

export const api = {
  auth,
  contracts,
  bills,
  maintenance,
  prepay,
  cleaning,
  notifications,
  tenants,
  public: publicApi,
}

export default api
