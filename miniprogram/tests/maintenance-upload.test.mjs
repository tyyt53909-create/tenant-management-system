import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// 说明：uni.uploadFile 是小程序原生 API，Node 环境不存在，故此处以 mock 验证
// 我们自己的调用契约（URL、字段名、鉴权头、成功/失败分支），
// 真实 multipart 落库由 scripts/e2e-mvp/run.mjs 的步骤 9b 用真实 HTTP 覆盖。

let uploads
let storage

beforeEach(() => {
  uploads = []
  storage = new Map([['access_token', 'unit-test-token']])
  globalThis.uni = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    uploadFile: (options) => {
      uploads.push(options)
      const reply = options.__reply
      if (reply && reply.fail) options.fail(new Error('offline'))
      else options.success(reply || { statusCode: 200, data: JSON.stringify({ url: '/api/files/ok.jpg' }) })
    },
  }
  // __API_BASE_URL__ 由构建期注入；测试环境走 resolveApiBaseUrl() 默认值
  globalThis.__API_BASE_URL__ = undefined
})

async function loadApi() {
  return import(`../api/index.js?case=${uploads.length}-${Math.random()}`)
}

test('uploadMaintenancePhoto 使用 multipart 字段名 file 并带鉴权头', async () => {
  const { uploadMaintenancePhoto } = await loadApi()
  const res = await uploadMaintenancePhoto('/tmp/a.jpg')

  assert.equal(uploads.length, 1)
  const opt = uploads[0]
  assert.equal(opt.name, 'file')
  assert.equal(opt.filePath, '/tmp/a.jpg')
  assert.ok(opt.url.endsWith('/files/upload'), 'URL 应以 /files/upload 结尾，实际 ' + opt.url)
  assert.equal(opt.header.Authorization, 'Bearer unit-test-token')
  assert.equal(res.url, '/api/files/ok.jpg')
})

test('无 token 时不发送 Authorization 头', async () => {
  storage.clear()
  const { uploadMaintenancePhoto } = await loadApi()
  await uploadMaintenancePhoto('/tmp/b.jpg')
  assert.equal(uploads[0].header.Authorization, undefined)
})

test('非 2xx 响应被拒绝并带出服务端 message', async () => {
  const { uploadMaintenancePhoto } = await loadApi()
  const original = globalThis.uni.uploadFile
  globalThis.uni.uploadFile = (options) => {
    uploads.push(options)
    options.success({ statusCode: 400, data: JSON.stringify({ message: '仅支持 JPG/PNG/WebP' }) })
  }
  await assert.rejects(() => uploadMaintenancePhoto('/tmp/c.gif'), /仅支持 JPG\/PNG\/WebP/)
  globalThis.uni.uploadFile = original
})

test('响应缺少 url 时被拒绝', async () => {
  const { uploadMaintenancePhoto } = await loadApi()
  globalThis.uni.uploadFile = (options) => {
    uploads.push(options)
    options.success({ statusCode: 200, data: JSON.stringify({ key: 'x' }) })
  }
  await assert.rejects(() => uploadMaintenancePhoto('/tmp/d.jpg'))
})

test('网络失败被拒绝', async () => {
  const { uploadMaintenancePhoto } = await loadApi()
  globalThis.uni.uploadFile = (options) => {
    uploads.push(options)
    options.fail(new Error('offline'))
  }
  await assert.rejects(() => uploadMaintenancePhoto('/tmp/e.jpg'), /上传失败/)
})
