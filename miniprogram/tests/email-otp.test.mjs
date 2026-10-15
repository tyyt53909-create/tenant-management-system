import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { sendEmailCode, loginWithEmailCode, bindInviteCode } from '../api/index.js'

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

test('sendEmailCode 通过 POST /auth/send-email-code 发送邮箱获取验证码', async () => {
  replies.push({
    status: 201,
    data: { message: '验证码已发送至您的邮箱，5分钟内有效', cooldown: 60 },
  })

  const res = await sendEmailCode({ email: 'test@example.com' })
  assert.equal(res.cooldown, 60)
  assert.equal(calls[0].url.endsWith('/auth/send-email-code'), true)
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].data.email, 'test@example.com')
})

test('loginWithEmailCode 通过 POST /auth/login-email-code 提交邮箱与验证码登录', async () => {
  replies.push({
    status: 201,
    data: {
      accessToken: 'otp-access-token',
      refreshToken: 'otp-refresh-token',
      user: { id: 'u-otp-1', email: 'test@example.com', role: 'TENANT' },
      isNewUser: false,
    },
  })

  const res = await loginWithEmailCode({
    email: 'test@example.com',
    code: '123456',
  })

  assert.equal(calls[0].url.endsWith('/auth/login-email-code'), true)
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].data.email, 'test@example.com')
  assert.equal(calls[0].data.code, '123456')
  assert.equal(res.accessToken, 'otp-access-token')
})

test('bindInviteCode 通过 POST /auth/bind-invite-code 提交邀请码绑定房源', async () => {
  replies.push({
    status: 201,
    data: {
      success: true,
      message: '邀请码兑换成功，房源身份已成功关联！',
    },
  })

  const res = await bindInviteCode({
    inviteCode: 'INVITE-TEST-999',
  })

  assert.equal(calls[0].url.endsWith('/auth/bind-invite-code'), true)
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].data.inviteCode, 'INVITE-TEST-999')
  assert.equal(res.success, true)
})
