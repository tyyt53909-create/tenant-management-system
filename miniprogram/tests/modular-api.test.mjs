import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import * as api from '../api/index.js'
import * as authApi from '../api/auth.js'
import * as contractsApi from '../api/contracts.js'
import * as billsApi from '../api/bills.js'
import * as maintenanceApi from '../api/maintenance.js'
import * as prepayApi from '../api/prepay.js'
import * as cleaningApi from '../api/cleaning.js'
import * as notificationsApi from '../api/notifications.js'
import request from '../utils/request.js'

let calls = []
let replies = []
let toasts = []

beforeEach(() => {
  calls = []
  replies = []
  toasts = []
  globalThis.uni = {
    getStorageSync: () => 'mock-access-token',
    setStorageSync: () => {},
    removeStorageSync: () => {},
    reLaunch: () => {},
    showToast: (options) => toasts.push(options.title),
    uploadFile: (options) => {
      calls.push(options)
      const reply = replies.shift() || { status: 200, data: { url: '/api/files/test.jpg' } }
      if (reply.fail) options.fail(new Error('upload fail'))
      else options.success({ statusCode: reply.status || 200, data: JSON.stringify(reply.data) })
    },
    request: (options) => {
      calls.push(options)
      const reply = replies.shift() || { status: 200, data: { ok: true } }
      if (reply.fail) options.fail(reply.err || new Error('offline'))
      else options.success({ statusCode: reply.status || 200, data: reply.data })
    },
  }
})

test('API 模块聚合与领域命名空间完整导出', () => {
  assert.equal(typeof api.login, 'function')
  assert.equal(typeof api.getMyContracts, 'function')
  assert.equal(typeof api.getMyBills, 'function')
  assert.equal(typeof api.getMyMaintenance, 'function')
  assert.equal(typeof api.getMyAccount, 'function')
  assert.equal(typeof api.getCleaningRooms, 'function')
  assert.equal(typeof api.getNotifications, 'function')

  assert.ok(api.default.auth)
  assert.ok(api.default.contracts)
  assert.ok(api.default.bills)
  assert.ok(api.default.maintenance)
  assert.ok(api.default.prepay)
  assert.ok(api.default.cleaning)
  assert.ok(api.default.notifications)
})

test('Auth API 接口正确调用对应 URL 与方法', async () => {
  replies.push(
    { data: { accessToken: 'a', refreshToken: 'r' } },
    { data: { message: 'sent' } },
    { data: { accessToken: 'b' } },
    { data: { message: 'bound' } },
    { data: { clientId: 'cid' } },
    { data: { accessToken: 'c' } },
    { data: { id: 'u1' } },
  )

  await authApi.login({ identifier: 'test@example.com', password: '123' })
  assert.ok(calls[0].url.endsWith('/auth/login'))
  assert.equal(calls[0].method, 'POST')

  await authApi.sendEmailCode({ email: 'test@example.com' })
  assert.ok(calls[1].url.endsWith('/auth/send-email-code'))

  await authApi.loginWithEmailCode({ email: 'test@example.com', code: '123456' })
  assert.ok(calls[2].url.endsWith('/auth/login-email-code'))

  await authApi.bindInviteCode({ inviteCode: 'INV-1' })
  assert.ok(calls[3].url.endsWith('/auth/bind-invite-code'))

  await authApi.getGoogleClientId()
  assert.ok(calls[4].url.endsWith('/auth/google/client-id'))

  await authApi.loginWithGoogle({ idToken: 'token' })
  assert.ok(calls[5].url.endsWith('/auth/google'))

  await authApi.getUserInfo()
  assert.ok(calls[6].url.endsWith('/auth/me'))
})

test('Contracts 与 Bills API 接口调用正确', async () => {
  replies.push(
    { data: [{ id: 'c1' }] },
    { data: [{ id: 'b1' }] },
    { data: { id: 'b1', amount: 100 } },
  )

  await contractsApi.getMyContracts()
  assert.ok(calls[0].url.endsWith('/contracts/my'))

  await billsApi.getMyBills({ status: 'PENDING' })
  assert.ok(calls[1].url.endsWith('/bills/my'))

  await billsApi.getBillDetail('b1')
  assert.ok(calls[2].url.endsWith('/bills/b1'))
})

test('Maintenance API 支持记录查询、详情、创建与图片上传', async () => {
  replies.push(
    { data: [] },
    { data: { id: 'm1' } },
    { data: { id: 'm2' } },
    { status: 200, data: { url: '/api/files/photo.jpg', key: 'photo.jpg' } },
  )

  await maintenanceApi.getMyMaintenance({ page: 1 })
  assert.ok(calls[0].url.endsWith('/maintenance/my'))

  await maintenanceApi.getMaintenanceDetail('m1')
  assert.ok(calls[1].url.endsWith('/maintenance/m1'))

  await maintenanceApi.createMaintenance({ roomId: 'r1', title: '漏水', description: '水管坏了' })
  assert.ok(calls[2].url.endsWith('/maintenance'))
  assert.equal(calls[2].method, 'POST')

  const uploadRes = await maintenanceApi.uploadMaintenancePhoto('temp://photo.jpg')
  assert.equal(uploadRes.url, '/api/files/photo.jpg')
  assert.ok(calls[3].url.endsWith('/files/upload'))
})

test('Prepay 与 Notifications API 接口正常请求', async () => {
  replies.push(
    { data: { balance: 500 } },
    { data: { data: [] } },
    { data: [] },
    { data: { count: 3 } },
    { data: {} },
    { data: {} },
    { data: {} },
  )

  await prepayApi.getMyAccount()
  assert.ok(calls[0].url.endsWith('/prepay-accounts/my'))

  await prepayApi.getRechargeRecords({ page: 1 })
  assert.ok(calls[1].url.endsWith('/prepay-accounts/transactions'))

  await notificationsApi.getNotifications({ page: 1 })
  assert.ok(calls[2].url.endsWith('/notifications'))

  await notificationsApi.getUnreadCount()
  assert.ok(calls[3].url.endsWith('/notifications/unread-count'))

  await notificationsApi.markNotificationRead('n1')
  assert.ok(calls[4].url.endsWith('/notifications/n1/read'))

  await notificationsApi.markAllNotificationsRead()
  assert.ok(calls[5].url.endsWith('/notifications/read-all'))

  await notificationsApi.deleteNotification('n1')
  assert.ok(calls[6].url.endsWith('/notifications/n1'))
})

test('统一错误码转换为友好中文提示', async () => {
  const cases = [
    { code: 'AUTH_INVALID_CREDENTIALS', expected: '账号或密码不正确' },
    { code: 'AUTH_TOKEN_EXPIRED', expected: '登录已失效，请重新登录' },
    { code: 'AUTH_INVITE_CODE_INVALID', expected: '邀请码无效或已使用' },
    { code: 'AUTH_INVITE_CODE_EXPIRED', expected: '邀请码已过期' },
    { code: 'AUTH_EMAIL_ALREADY_EXISTS', expected: '该邮箱已被注册' },
    { code: 'PERM_FORBIDDEN', expected: '您没有权限执行此操作' },
    { code: 'ROOM_VERSION_CONFLICT', expected: '房态信息已被他人更新，请刷新重试' },
    { code: 'ROOM_NOT_AVAILABLE', expected: '房源当前状态不允许此操作' },
    { code: 'BILL_ALREADY_PAID', expected: '该账单已完成缴费，无需重复操作' },
    { code: 'BILL_PAYMENT_EXCEEDS_AMOUNT', expected: '支付金额不能超过账单待缴金额' },
    { code: 'PREPAY_INSUFFICIENT_BALANCE', expected: '预付账户余额不足，请先充值' },
    { code: 'COMMON_CONFLICT', expected: '数据已存在或已被修改，请刷新后重试' },
    { code: 'COMMON_RESOURCE_NOT_FOUND', expected: '请求的资源不存在' },
  ]

  for (const { code, expected } of cases) {
    replies.push({ status: 400, data: { code, message: 'raw' } })
    await assert.rejects(
      request.get('/test'),
      (err) => err.message === expected,
    )
  }
})

test('弱网超时与断网友好提示且不抛未捕获异常', async () => {
  // 断网异常
  replies.push({ fail: true, err: { errMsg: 'request:fail net::ERR_CONNECTION_REFUSED' } })
  await assert.rejects(
    request.get('/test'),
    (err) => err.isNetworkError && err.message === '网络连接失败，请检查网络设置',
  )
  assert.equal(toasts.at(-1), '网络连接失败，请检查网络设置')

  // 超时异常
  replies.push({ fail: true, err: { errMsg: 'request:fail timeout' } })
  await assert.rejects(
    request.get('/test'),
    (err) => err.isNetworkError && err.message === '网络请求超时，请检查网络后重试',
  )
  assert.equal(toasts.at(-1), '网络请求超时，请检查网络后重试')
})
