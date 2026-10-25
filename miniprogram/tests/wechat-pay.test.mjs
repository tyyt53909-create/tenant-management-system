import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { payBillWithWechatJsapi, queryWechatPaymentStatus } from '../api/index.js'

let calls, replies
beforeEach(() => {
  calls = []
  replies = []
  globalThis.uni = {
    getStorageSync: () => 'mock-jwt-token',
    setStorageSync: () => {},
    removeStorageSync: () => {},
    request: (options) => {
      calls.push(options)
      const reply = replies.shift() || { status: 200, data: {} }
      if (reply.fail) options.fail(new Error('network error'))
      else options.success({ statusCode: reply.status || 200, data: reply.data })
    },
  }
})

test('payBillWithWechatJsapi 请求 POST /bills/:id/pay/wechat-jsapi 获取拉起支付参数', async () => {
  replies.push({
    status: 201,
    data: {
      appId: 'wx_mock_appid',
      timeStamp: '1729891200',
      nonceStr: 'mock_nonce_123',
      package: 'prepay_id=mock_prepay_888',
      signType: 'RSA',
      paySign: 'mock_pay_sign_xyz',
      outTradeNo: 'WP_1729891200_1234',
    },
  })

  const res = await payBillWithWechatJsapi('bill-001', { amount: 250000 })
  assert.equal(res.appId, 'wx_mock_appid')
  assert.equal(res.package, 'prepay_id=mock_prepay_888')
  assert.equal(res.outTradeNo, 'WP_1729891200_1234')
  assert.equal(calls[0].url.endsWith('/bills/bill-001/pay/wechat-jsapi'), true)
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].data.amount, 250000)
})

test('queryWechatPaymentStatus 请求 POST /bills/:id/pay/wechat-query 主动查单', async () => {
  replies.push({
    status: 201,
    data: {
      synced: true,
      order: { orderId: 'WP_1729891200_1234', status: 'SUCCESS' },
      bill: { id: 'bill-001', status: 'PAID' },
    },
  })

  const res = await queryWechatPaymentStatus('bill-001', { outTradeNo: 'WP_1729891200_1234' })
  assert.equal(res.synced, true)
  assert.equal(res.order.status, 'SUCCESS')
  assert.equal(calls[0].url.endsWith('/bills/bill-001/pay/wechat-query'), true)
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].data.outTradeNo, 'WP_1729891200_1234')
})
