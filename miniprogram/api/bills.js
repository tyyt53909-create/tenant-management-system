import request from '../utils/request.js'
import { API_BASE_URL } from '../utils/api-config.js'

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

/**
 * 微信支付 JSAPI 下单
 * @param {string} billId - 账单 ID
 * @param {{ amount?: number }} [data]
 * @returns {Promise<{
 *   appId: string,
 *   timeStamp: string,
 *   nonceStr: string,
 *   package: string,
 *   signType: string,
 *   paySign: string,
 *   outTradeNo: string
 * }>}
 */
export const payBillWithWechatJsapi = (billId, data) => {
  return request.post(`/bills/${billId}/pay/wechat-jsapi`, data)
}

/**
 * 微信支付状态主动查询补单
 * @param {string} billId - 账单 ID
 * @param {{ outTradeNo: string }} data
 * @returns {Promise<{ synced: boolean, order: any, bill: any }>}
 */
export const queryWechatPaymentStatus = (billId, data) => {
  return request.post(`/bills/${billId}/pay/wechat-query`, data)
}

/**
 * 获取整张账单的电子收款收据
 * @param {string} billId - 账单 ID
 */
export const getBillReceipt = (billId) => {
  return request.get(`/bills/${billId}/receipt`)
}

/**
 * 获取单笔收款记录的收据凭证
 * @param {string} billId - 账单 ID
 * @param {string} paymentId - 支付记录 ID
 */
export const getPaymentReceipt = (billId, paymentId) => {
  return request.get(`/bills/${billId}/payments/${paymentId}/receipt`)
}

/**
 * 获取租客名下全部电子收款收据
 */
export const getMyReceipts = () => {
  return request.get('/bills/my/receipts')
}

/**
 * 公开防伪验真查验收据
 * @param {string} receiptNumber - 收据编号
 * @param {string} [code] - 防伪校验码
 */
export const verifyReceipt = (receiptNumber, code) => {
  const query = code ? `?code=${encodeURIComponent(code)}` : ''
  return request.get(`/public/receipts/${encodeURIComponent(receiptNumber)}/verify${query}`)
}

/**
 * 下载并本地预览公开电子收据 PDF
 * @param {string} receiptNumber - 收据编号
 */
export const downloadReceiptPdf = (receiptNumber) => {
  return new Promise((resolve, reject) => {
    const token = typeof uni !== 'undefined' && uni.getStorageSync ? uni.getStorageSync('access_token') : ''
    const url = `${API_BASE_URL}/public/receipts/${encodeURIComponent(receiptNumber)}/pdf`
    if (typeof uni === 'undefined' || !uni.downloadFile) {
      resolve({ url })
      return
    }
    uni.downloadFile({
      url,
      header: token ? { Authorization: `Bearer ${token}` } : {},
      success: (res) => {
        if (res.statusCode === 200 && res.tempFilePath) {
          if (uni.openDocument) {
            uni.openDocument({
              filePath: res.tempFilePath,
              fileType: 'pdf',
              showMenu: true,
              success: () => resolve({ filePath: res.tempFilePath }),
              fail: () => resolve({ filePath: res.tempFilePath }),
            })
          } else {
            resolve({ filePath: res.tempFilePath })
          }
        } else {
          reject(new Error(`下载失败 (状态码: ${res.statusCode})`))
        }
      },
      fail: (err) => reject(err),
    })
  })
}

/**
 * 下载并本地预览指定账单/付款电子收据 PDF
 * @param {string} billId - 账单 ID
 * @param {string} [paymentId] - 支付记录 ID
 */
export const downloadBillReceiptPdf = (billId, paymentId) => {
  return new Promise((resolve, reject) => {
    const token = typeof uni !== 'undefined' && uni.getStorageSync ? uni.getStorageSync('access_token') : ''
    const endpoint = paymentId
      ? `/bills/${billId}/payments/${paymentId}/receipt/pdf`
      : `/bills/${billId}/receipt/pdf`
    const url = `${API_BASE_URL}${endpoint}`
    if (typeof uni === 'undefined' || !uni.downloadFile) {
      resolve({ url })
      return
    }
    uni.downloadFile({
      url,
      header: token ? { Authorization: `Bearer ${token}` } : {},
      success: (res) => {
        if (res.statusCode === 200 && res.tempFilePath) {
          if (uni.openDocument) {
            uni.openDocument({
              filePath: res.tempFilePath,
              fileType: 'pdf',
              showMenu: true,
              success: () => resolve({ filePath: res.tempFilePath }),
              fail: () => resolve({ filePath: res.tempFilePath }),
            })
          } else {
            resolve({ filePath: res.tempFilePath })
          }
        } else {
          reject(new Error(`下载失败 (状态码: ${res.statusCode})`))
        }
      },
      fail: (err) => reject(err),
    })
  })
}
