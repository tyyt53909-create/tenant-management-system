import test from 'node:test'
import assert from 'node:assert/strict'

test('401 后用新的 refresh token 轮换并重试', async () => {
  const storage = new Map([
    ['access_token', 'expired'],
    ['refresh_token', 'old-refresh'],
  ])
  const calls = []
  globalThis.uni = {
    getStorageSync: (key) => storage.get(key) || '',
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    reLaunch: () => {},
    showToast: () => {},
    request: (options) => {
      calls.push({ url: options.url, authorization: options.header?.Authorization || '' })
      if (options.url.endsWith('/auth/refresh')) {
        options.success({
          statusCode: 200,
          data: { accessToken: 'new-access', refreshToken: 'rotated-refresh' },
        })
        return
      }
      if (options.header?.Authorization !== 'Bearer new-access') {
        options.success({ statusCode: 401, data: { message: 'expired' } })
        return
      }
      options.success({ statusCode: 200, data: { ok: true } })
    },
  }

  const { default: request } = await import('../utils/request.js')
  const data = await request.get('/rooms')
  assert.equal(data.ok, true)
  assert.equal(storage.get('access_token'), 'new-access')
  assert.equal(storage.get('refresh_token'), 'rotated-refresh')
  assert.equal(calls.filter((call) => call.url.endsWith('/auth/refresh')).length, 1)
})
