import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  rechargeWechatJsapi,
  queryRechargeStatus,
  requestPrepayPayment,
  payBillWithPrepay,
} from '../api/index.js'

let calls, replies
beforeEach(() => {
  calls = []
  replies = []
  globalThis.uni = {
    getStorageSync: () => 'mock-jwt-token',
    setStorageSync: () => {},
    removeStorageSync: () => {},
    requestPayment: (options) => {
      calls.push({ type: 'requestPayment', ...options })
      options.success({ errMsg: 'requestPayment:ok' })
    },
    request: (options) => {
      calls.push(options)
      const reply = replies.shift() || { status: 200, data: {} }
      if (reply.fail) options.fail(new Error('network error'))
      else options.success({ statusCode: reply.status || 200, data: reply.data })
    },
  }
})

test('rechargeWechatJsapi 请求 POST /prepay-accounts/my/recharge/wechat-jsapi 获取拉起参数', async () => {
  replies.push({
    status: 201,
    data: {
      appId: 'wx_mock_appid',
      timeStamp: '1729891200',
      nonceStr: 'mock_nonce_123',
      package: 'prepay_id=mock_prepay_888',
      signType: 'RSA',
      paySign: 'mock_pay_sign_xyz',
      outTradeNo: 'PREPAY_1729891200_1234',
      orderId: 'order-1',
    },
  })

  const res = await rechargeWechatJsapi(5000)
  assert.equal(res.appId, 'wx_mock_appid')
  assert.equal(res.package, 'prepay_id=mock_prepay_888')
  assert.equal(res.outTradeNo, 'PREPAY_1729891200_1234')
  assert.equal(calls[0].url.endsWith('/prepay-accounts/my/recharge/wechat-jsapi'), true)
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].data.amount, 5000)
})

test('queryRechargeStatus 请求 POST /prepay-accounts/my/recharge/wechat-query 主动查单', async () => {
  replies.push({
    status: 201,
    data: {
      orderId: 'order-1',
      outTradeNo: 'PREPAY_1729891200_1234',
      status: 'SUCCESS',
      amount: 5000,
    },
  })

  const res = await queryRechargeStatus('PREPAY_1729891200_1234')
  assert.equal(res.status, 'SUCCESS')
  assert.equal(calls[0].url.endsWith('/prepay-accounts/my/recharge/wechat-query'), true)
  assert.equal(calls[0].data.outTradeNo, 'PREPAY_1729891200_1234')
})

test('requestPrepayPayment 完整调用拉起下单、原生支付与查单补同步流程', async () => {
  // 1. 下单响应
  replies.push({
    status: 201,
    data: {
      appId: 'wx_mock_appid',
      timeStamp: '1729891200',
      nonceStr: 'mock_nonce_123',
      package: 'prepay_id=mock_prepay_888',
      signType: 'RSA',
      paySign: 'mock_pay_sign_xyz',
      outTradeNo: 'PREPAY_1729891200_1234',
      orderId: 'order-1',
    },
  })
  // 2. 查单响应
  replies.push({
    status: 201,
    data: {
      orderId: 'order-1',
      outTradeNo: 'PREPAY_1729891200_1234',
      status: 'SUCCESS',
      amount: 10000,
    },
  })

  const res = await requestPrepayPayment(10000)
  assert.equal(res.status, 'SUCCESS')
  assert.equal(calls.some((c) => c.type === 'requestPayment'), true)
})

test('payBillWithPrepay 请求 POST /bills/:id/pay/prepay 预付余额抵扣', async () => {
  replies.push({
    status: 201,
    data: {
      payment: { id: 'pmt-1', amount: 5000, paymentMethod: 'PREPAY' },
      bill: { id: 'bill-1', status: 'PAID' },
    },
  })

  const res = await payBillWithPrepay('bill-1', { amount: 5000 })
  assert.equal(res.payment.paymentMethod, 'PREPAY')
  assert.equal(calls[0].url.endsWith('/bills/bill-1/pay/prepay'), true)
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].data.amount, 5000)
})
