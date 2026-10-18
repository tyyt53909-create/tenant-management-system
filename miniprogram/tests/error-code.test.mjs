import test from 'node:test'
import assert from 'node:assert/strict'
import request from '../utils/request.js'

test('按错误码提示，能力暂停不再把代号直接展示', async () => {
  const toasts = []
  globalThis.uni = {
    getStorageSync: () => '',
    setStorageSync: () => {},
    removeStorageSync: () => {},
    reLaunch: () => {},
    showToast: (options) => toasts.push(options.title),
    request: (options) => {
      options.success({
        statusCode: 403,
        data: { code: 'CAPABILITY_DENIED', message: 'CAPABILITY_DENIED', requestId: 'req-1' },
      })
    },
  }

  await assert.rejects(request.get('/bills'), (error) => {
    assert.equal(error.code, 'CAPABILITY_DENIED')
    assert.equal(error.message, '当前账号的这项功能已暂停')
    return true
  })
  assert.deepEqual(toasts, ['当前账号的这项功能已暂停'])
})

test('内部错误不展示 SQL', async () => {
  const toasts = []
  globalThis.uni = {
    getStorageSync: () => '',
    setStorageSync: () => {},
    removeStorageSync: () => {},
    reLaunch: () => {},
    showToast: (options) => toasts.push(options.title),
    request: (options) => {
      options.success({
        statusCode: 500,
        data: { code: 'COMMON_INTERNAL_ERROR', message: 'SELECT password FROM users', requestId: 'req-2' },
      })
    },
  }

  await assert.rejects(request.get('/rooms'), (error) => {
    assert.equal(error.code, 'COMMON_INTERNAL_ERROR')
    assert.equal(error.message, '服务器内部错误，请稍后重试')
    return true
  })
  assert.deepEqual(toasts, ['服务器内部错误，请稍后重试'])
})
