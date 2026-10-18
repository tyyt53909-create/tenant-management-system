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

test('并发 401 只发一次刷新，各自用新令牌重试（T208 单飞）', async () => {
  const storage = new Map([
    ['access_token', 'expired'],
    ['refresh_token', 'old-refresh'],
  ])
  let refreshCalls = 0
  let relaunched = 0
  globalThis.uni = {
    getStorageSync: (key) => storage.get(key) || '',
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    reLaunch: () => { relaunched += 1 },
    showToast: () => {},
    request: (options) => {
      if (options.url.endsWith('/auth/refresh')) {
        refreshCalls += 1
        // 异步返回，制造真正的并发窗口：两个 401 都会先走到刷新这一层
        setTimeout(() => {
          options.success({
            statusCode: 200,
            data: { accessToken: 'new-access', refreshToken: 'rotated-refresh' },
          })
        }, 5)
        return
      }
      if (options.header?.Authorization === 'Bearer new-access') {
        options.success({ statusCode: 200, data: { ok: true } })
        return
      }
      options.success({ statusCode: 401, data: { message: 'expired' } })
    },
  }

  const { default: request } = await import('../utils/request.js')
  const [first, second] = await Promise.all([request.get('/a'), request.get('/b')])

  assert.equal(refreshCalls, 1)
  assert.equal(relaunched, 0)
  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
})

test('跨运行时并发轮换：拿到「正在轮换中」后改用存储里的新令牌重试，不清会话（T208）', async () => {
  const storage = new Map([
    ['access_token', 'expired'],
    ['refresh_token', 'old-refresh'],
  ])
  let relaunched = 0
  globalThis.uni = {
    getStorageSync: (key) => storage.get(key) || '',
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    reLaunch: () => { relaunched += 1 },
    showToast: () => {},
    request: (options) => {
      if (options.url.endsWith('/auth/refresh')) {
        // 另一个标签页刚赢下轮换：新令牌已写进共享存储，本运行时的请求用旧令牌被挡
        storage.set('access_token', 'new-access')
        storage.set('refresh_token', 'rotated-refresh')
        options.success({
          statusCode: 401,
          data: { message: '刷新令牌正在轮换中，请稍后重试' },
        })
        return
      }
      if (options.header?.Authorization === 'Bearer new-access') {
        options.success({ statusCode: 200, data: { ok: true } })
        return
      }
      options.success({ statusCode: 401, data: { message: 'expired' } })
    },
  }

  const { default: request } = await import('../utils/request.js')
  const data = await request.get('/rooms')

  assert.equal(data.ok, true)
  assert.equal(relaunched, 0)
  assert.equal(storage.get('access_token'), 'new-access')
})
