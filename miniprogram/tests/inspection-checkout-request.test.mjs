import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  createCheckoutRequest,
  getMyCheckoutRequests,
  getCheckoutRequestDetail,
  cancelCheckoutRequest,
  getMyInspections,
  getInspectionDetail,
  confirmInspection,
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

test('createCheckoutRequest 发送 POST /checkout/requests', async () => {
  replies.push({
    status: 201,
    data: { id: 'req-1', status: 'PENDING', requestNumber: 'CR001' },
  })

  const payload = {
    contractId: 'c1',
    expectedCheckoutDate: '2026-12-01',
    reasonType: 'NORMAL_EXPIRE',
  }
  const res = await createCheckoutRequest(payload)
  assert.equal(res.id, 'req-1')
  assert.equal(calls[0].url.endsWith('/checkout/requests'), true)
  assert.equal(calls[0].method, 'POST')
})

test('getMyCheckoutRequests 发送 GET /checkout/requests/my', async () => {
  replies.push({
    status: 200,
    data: [{ id: 'req-1', status: 'PENDING' }],
  })

  const res = await getMyCheckoutRequests({ status: 'PENDING' })
  assert.equal(res.length, 1)
  assert.equal(calls[0].url.endsWith('/checkout/requests/my'), true)
})

test('getCheckoutRequestDetail 发送 GET /checkout/requests/:id', async () => {
  replies.push({
    status: 200,
    data: { id: 'req-1', requestNumber: 'CR001' },
  })

  const res = await getCheckoutRequestDetail('req-1')
  assert.equal(res.id, 'req-1')
  assert.equal(calls[0].url.endsWith('/checkout/requests/req-1'), true)
})

test('cancelCheckoutRequest 发送 POST /checkout/requests/:id/cancel', async () => {
  replies.push({
    status: 201,
    data: { id: 'req-1', status: 'CANCELLED' },
  })

  const res = await cancelCheckoutRequest('req-1')
  assert.equal(res.status, 'CANCELLED')
  assert.equal(calls[0].url.endsWith('/checkout/requests/req-1/cancel'), true)
  assert.equal(calls[0].method, 'POST')
})

test('getMyInspections 发送 GET /inspections/my', async () => {
  replies.push({
    status: 200,
    data: [{ id: 'insp-1', type: 'CHECK_IN', status: 'PENDING_CONFIRM' }],
  })

  const res = await getMyInspections({ type: 'CHECK_IN' })
  assert.equal(res.length, 1)
  assert.equal(calls[0].url.endsWith('/inspections/my'), true)
})

test('getInspectionDetail 发送 GET /inspections/:id', async () => {
  replies.push({
    status: 200,
    data: { id: 'insp-1', items: [{ name: '钥匙' }] },
  })

  const res = await getInspectionDetail('insp-1')
  assert.equal(res.id, 'insp-1')
  assert.equal(calls[0].url.endsWith('/inspections/insp-1'), true)
})

test('confirmInspection 发送 POST /inspections/:id/confirm', async () => {
  replies.push({
    status: 201,
    data: { id: 'insp-1', status: 'CONFIRMED' },
  })

  const res = await confirmInspection('insp-1', {
    agree: true,
    tenantNotes: '确认无误',
  })
  assert.equal(res.status, 'CONFIRMED')
  assert.equal(calls[0].url.endsWith('/inspections/insp-1/confirm'), true)
  assert.equal(calls[0].method, 'POST')
})
