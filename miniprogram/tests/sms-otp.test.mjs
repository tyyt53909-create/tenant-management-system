import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { sendSmsCode, loginWithSmsCode, bindPhoneSms } from '../api/index.js'

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

test('sendSmsCode 通过 POST /auth/send-sms-code 请求发送短信验证码', async () => {
  replies.push({
    status: 201,
    data: { message: '验证码已发送至您的手机，5分钟内有效', cooldown: 60 },
  })

  const res = await sendSmsCode({ phone: '13812345678' })
  assert.equal(res.cooldown, 60)
  assert.equal(calls[0].url.endsWith('/auth/send-sms-code'), true)
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].data.phone, '13812345678')
})

test('loginWithSmsCode 通过 POST /auth/login-sms-code 提交手机与验证码登录', async () => {
  replies.push({
    status: 201,
    data: {
      accessToken: 'sms-otp-token',
      refreshToken: 'sms-refresh-token',
      user: { id: 'u-sms-1', phone: '13812345678', role: 'TENANT' },
      isNewUser: false,
    },
  })

  const res = await loginWithSmsCode({
    phone: '13812345678',
    code: '123456',
  })

  assert.equal(res.accessToken, 'sms-otp-token')
  assert.equal(calls[0].url.endsWith('/auth/login-sms-code'), true)
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].data.phone, '13812345678')
  assert.equal(calls[0].data.code, '123456')
})

test('bindPhoneSms 通过 POST /auth/bind-phone-sms 绑定手机号', async () => {
  replies.push({
    status: 201,
    data: {
      success: true,
      message: '手机号绑定成功！',
      phone: '13988889999',
    },
  })

  const res = await bindPhoneSms({
    phone: '13988889999',
    code: '654321',
  })

  assert.equal(res.success, true)
  assert.equal(res.phone, '13988889999')
  assert.equal(calls[0].url.endsWith('/auth/bind-phone-sms'), true)
  assert.equal(calls[0].method, 'POST')
})
