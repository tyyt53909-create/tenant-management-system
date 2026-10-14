import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { getGoogleClientId, loginWithGoogle } from '../api/index.js'

let calls, replies
beforeEach(() => {
  calls = []
  replies = []
  globalThis.uni = {
    getStorageSync: () => null,
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

test('getGoogleClientId 请求正确的后端路径并返回 clientId', async () => {
  replies.push({
    status: 200,
    data: { clientId: 'test-google-client-id' },
  })

  const res = await getGoogleClientId()
  assert.equal(res.clientId, 'test-google-client-id')
  assert.equal(calls[0].url.endsWith('/auth/google/client-id'), true)
  assert.equal(calls[0].method, 'GET')
})

test('loginWithGoogle 通过 POST 请求发送 idToken 与 inviteCode', async () => {
  replies.push({
    status: 201,
    data: {
      accessToken: 'mock-access',
      refreshToken: 'mock-refresh',
      user: { id: 'u1', role: 'TENANT' },
    },
  })

  const res = await loginWithGoogle({
    idToken: 'mock-google-token:test@gmail.com',
    inviteCode: 'INVITE-123',
  })

  assert.equal(calls[0].url.endsWith('/auth/google'), true)
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].data.idToken, 'mock-google-token:test@gmail.com')
  assert.equal(calls[0].data.inviteCode, 'INVITE-123')
  assert.equal(res.accessToken, 'mock-access')
})
