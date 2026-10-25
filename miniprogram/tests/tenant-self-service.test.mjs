import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  getMyOverview,
  getMyReceipts,
  verifyReceipt,
  downloadReceiptPdf,
  downloadBillReceiptPdf,
  getMyRegistration,
  submitMyRegistration,
  getBillReceipt,
} from '../api/index.js'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

let calls = []
let replies = []
let downloadCalls = []
let openDocCalls = []

beforeEach(() => {
  calls = []
  replies = []
  downloadCalls = []
  openDocCalls = []
  globalThis.uni = {
    getStorageSync: (k) => (k === 'access_token' ? 'mock-jwt-token' : ''),
    setStorageSync: () => {},
    removeStorageSync: () => {},
    showLoading: () => {},
    hideLoading: () => {},
    showToast: () => {},
    navigateTo: () => {},
    reLaunch: () => {},
    downloadFile: (options) => {
      downloadCalls.push(options)
      options.success({ statusCode: 200, tempFilePath: '/tmp/receipt.pdf' })
    },
    openDocument: (options) => {
      openDocCalls.push(options)
      options.success()
    },
    request: (options) => {
      calls.push(options)
      const reply = replies.shift() || { status: 200, data: {} }
      if (reply.fail) options.fail(new Error('network error'))
      else options.success({ statusCode: reply.status || 200, data: reply.data })
    },
  }
})

test('getMyOverview 请求 GET /tenants/me/overview 获取总览看板数据', async () => {
  replies.push({
    status: 200,
    data: {
      bound: true,
      contract: { contractNumber: 'CN-001', daysRemaining: 180 },
      bills: { pendingCount: 1, pendingAmountYuan: '2500.00' },
      prepay: { balanceYuan: '300.00' },
      maintenance: { activeCount: 0 },
      registration: { status: 'REGISTERED' },
    },
  })

  const res = await getMyOverview()
  assert.equal(res.bound, true)
  assert.equal(res.contract.daysRemaining, 180)
  assert.equal(res.bills.pendingAmountYuan, '2500.00')
  assert.ok(calls[0].url.endsWith('/tenants/me/overview'))
  assert.equal(calls[0].method, 'GET')
})

test('getMyReceipts 请求 GET /bills/my/receipts 获取租客收据列表', async () => {
  replies.push({
    status: 200,
    data: [
      { receiptNumber: 'R20261025000001', amountYuan: '2500.00', verifyCode: 'CODE123456789012' },
    ],
  })

  const list = await getMyReceipts()
  assert.equal(list.length, 1)
  assert.equal(list[0].receiptNumber, 'R20261025000001')
  assert.ok(calls[0].url.endsWith('/bills/my/receipts'))
  assert.equal(calls[0].method, 'GET')
})

test('verifyReceipt 请求 GET /public/receipts/:receiptNumber/verify 并支持 code 参数', async () => {
  replies.push({
    status: 200,
    data: { receiptNumber: 'R20261025000001', isValid: true, isVoided: false },
  })

  const res = await verifyReceipt('R20261025000001', 'CODE1234')
  assert.equal(res.isValid, true)
  assert.ok(calls[0].url.includes('/public/receipts/R20261025000001/verify?code=CODE1234'))
  assert.equal(calls[0].method, 'GET')
})

test('downloadReceiptPdf 调用 uni.downloadFile 与 uni.openDocument 打开 PDF', async () => {
  const res = await downloadReceiptPdf('R20261025000001')
  assert.equal(res.filePath, '/tmp/receipt.pdf')
  assert.equal(downloadCalls.length, 1)
  assert.ok(downloadCalls[0].url.includes('/public/receipts/R20261025000001/pdf'))
  assert.equal(openDocCalls.length, 1)
  assert.equal(openDocCalls[0].filePath, '/tmp/receipt.pdf')
  assert.equal(openDocCalls[0].fileType, 'pdf')
})

test('downloadBillReceiptPdf 支持整单或单笔付款收据导出', async () => {
  await downloadBillReceiptPdf('bill-101')
  assert.ok(downloadCalls[0].url.endsWith('/bills/bill-101/receipt/pdf'))

  await downloadBillReceiptPdf('bill-101', 'pay-202')
  assert.ok(downloadCalls[1].url.endsWith('/bills/bill-101/payments/pay-202/receipt/pdf'))
})

test('getMyRegistration 与 submitMyRegistration 请求正确的租客实名端点', async () => {
  replies.push({
    status: 200,
    data: { status: 'NOT_REGISTERED', idNumberMasked: null },
  })
  const reg = await getMyRegistration()
  assert.equal(reg.status, 'NOT_REGISTERED')
  assert.ok(calls[0].url.endsWith('/tenants/me/registration'))
  assert.equal(calls[0].method, 'GET')

  replies.push({
    status: 201,
    data: { message: '提交成功', registration: { status: 'PENDING' } },
  })
  const submitRes = await submitMyRegistration({
    idType: 'ID_CARD',
    idNumber: '110101199001011234',
    realName: '张三',
  })
  assert.equal(submitRes.message, '提交成功')
  assert.equal(calls[1].method, 'POST')
  assert.equal(calls[1].data.idNumber, '110101199001011234')
  assert.equal(calls[1].data.realName, '张三')
})
