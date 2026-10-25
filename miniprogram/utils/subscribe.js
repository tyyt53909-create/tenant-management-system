import { reportSubscribeResult } from '../api/notifications.js'

/**
 * 调起小程序订阅消息授权弹窗并上报结果（WX-02 / T291）
 * @param {string[]} templateIds - 需订阅的模板 ID 列表
 * @returns {Promise<any>}
 */
export async function requestAndReportSubscribe(templateIds = []) {
  if (!Array.isArray(templateIds) || templateIds.length === 0) return {}

  if (typeof uni === 'undefined' || typeof uni.requestSubscribeMessage !== 'function') {
    return {}
  }

  // #ifdef MP-WEIXIN
  return new Promise((resolve) => {
    uni.requestSubscribeMessage({
      tmplIds: templateIds,
      success: async (res) => {
        const reportPromises = templateIds.map((tmplId) => {
          const action = res[tmplId]
          if (action === 'accept' || action === 'reject' || action === 'ban') {
            return reportSubscribeResult({ templateId: tmplId, action }).catch(() => {})
          }
          return Promise.resolve()
        })
        await Promise.all(reportPromises)
        resolve(res)
      },
      fail: () => {
        resolve({})
      },
    })
  })
  // #endif

  // #ifndef MP-WEIXIN
  return {}
  // #endif
}
