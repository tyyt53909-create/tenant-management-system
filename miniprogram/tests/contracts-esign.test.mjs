import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  getMyContracts,
  getContractDetail,
  getContractSignStatus,
  getContractPdfUrl,
  getDefaultContractTemplate,
  mockCompleteContractSign,
} from '../api/index.js'

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

test('getMyContracts 请求 GET /contracts/my', async () => {
  replies.push({
    status: 200,
    data: [{ id: 'c1', contractNumber: 'C1001', status: 'ACTIVE' }],
  })

  const res = await getMyContracts()
  assert.equal(res.length, 1)
  assert.equal(calls[0].url.endsWith('/contracts/my'), true)
})

test('getContractDetail 请求 GET /contracts/:id 并返回包含共同承租人的合同详情', async () => {
  replies.push({
    status: 200,
    data: {
      id: 'c1',
      contractNumber: 'C1001',
      coTenants: [{ name: '李四', phone: '13800000002', isSigner: true }],
    },
  })

  const res = await getContractDetail('c1')
  assert.equal(res.id, 'c1')
  assert.equal(res.coTenants.length, 1)
  assert.equal(calls[0].url.endsWith('/contracts/c1'), true)
})

test('getContractSignStatus 请求 GET /contracts/:id/sign/status 查询电子签进度', async () => {
  replies.push({
    status: 200,
    data: {
      contractId: 'c1',
      signStatus: 'SIGNING',
      flowId: 'flow-123',
    },
  })

  const res = await getContractSignStatus('c1')
  assert.equal(res.signStatus, 'SIGNING')
  assert.equal(calls[0].url.endsWith('/contracts/c1/sign/status'), true)
})

test('getContractPdfUrl 返回标准的合同 PDF 下载路径', () => {
  const url = getContractPdfUrl('c1')
  assert.equal(url, '/api/contracts/c1/pdf')
})

test('getDefaultContractTemplate 请求 GET /contract-templates/default', async () => {
  replies.push({
    status: 200,
    data: { id: 'tmpl-1', code: 'STANDARD_RESIDENTIAL' },
  })

  const res = await getDefaultContractTemplate()
  assert.equal(res.code, 'STANDARD_RESIDENTIAL')
  assert.equal(calls[0].url.endsWith('/contract-templates/default'), true)
})

test('mockCompleteContractSign 请求 POST /contracts/:id/sign/mock-complete', async () => {
  replies.push({
    status: 200,
    data: { id: 'c1', signStatus: 'SIGNED' },
  })

  const res = await mockCompleteContractSign('c1')
  assert.equal(res.signStatus, 'SIGNED')
  assert.equal(calls[0].url.endsWith('/contracts/c1/sign/mock-complete'), true)
  assert.equal(calls[0].method, 'POST')
})
