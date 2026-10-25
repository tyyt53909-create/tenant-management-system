import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  getPublicRooms,
  getPublicRoomDetail,
  getRoomShareInfo,
  submitPublicLead,
  submitPublicAppointment,
  getMyAppointments,
  cancelAppointment,
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

test('getPublicRooms 请求 GET /public/rooms 并带价格与户型筛选参数', async () => {
  replies.push({
    status: 200,
    data: {
      data: [{ id: 'room-1', roomNumber: '101', listingPrice: 250000 }],
      meta: { total: 1 },
    },
  })

  const res = await getPublicRooms({ minPrice: 200000, maxPrice: 300000, roomType: 'ONE_BED' })
  assert.equal(res.data.length, 1)
  assert.equal(calls[0].url.endsWith('/public/rooms'), true)
  assert.equal(calls[0].data.minPrice, 200000)
  assert.equal(calls[0].data.roomType, 'ONE_BED')
})

test('getPublicRoomDetail 请求 GET /public/rooms/:id', async () => {
  replies.push({
    status: 200,
    data: { id: 'room-1', roomNumber: '101', listingPrice: 250000 },
  })

  const res = await getPublicRoomDetail('room-1')
  assert.equal(res.id, 'room-1')
  assert.equal(calls[0].url.endsWith('/public/rooms/room-1'), true)
})

test('getRoomShareInfo 请求 GET /public/rooms/:id/share 获取分享数据', async () => {
  replies.push({
    status: 200,
    data: {
      title: 'A栋 101室 · ONE_BED (¥2500.00/月)',
      path: '/pages/index/index?roomId=room-1',
    },
  })

  const res = await getRoomShareInfo('room-1')
  assert.equal(res.title.includes('101室'), true)
  assert.equal(calls[0].url.endsWith('/public/rooms/room-1/share'), true)
})

test('submitPublicLead 请求 POST /public/leads 提交意向留资', async () => {
  replies.push({
    status: 201,
    data: { id: 'lead-1', message: '提交成功' },
  })

  const res = await submitPublicLead({ name: '张三', phone: '13800000000', budgetMin: 200000 })
  assert.equal(res.id, 'lead-1')
  assert.equal(calls[0].url.endsWith('/public/leads'), true)
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].data.phone, '13800000000')
})

test('submitPublicAppointment 请求 POST /public/appointments 发起看房预约', async () => {
  replies.push({
    status: 201,
    data: { id: 'appt-1', status: 'PENDING' },
  })

  const res = await submitPublicAppointment({
    roomId: 'room-1',
    name: '李四',
    phone: '13900000000',
    appointmentTime: '2026-11-01T14:00:00.000Z',
  })
  assert.equal(res.status, 'PENDING')
  assert.equal(calls[0].url.endsWith('/public/appointments'), true)
  assert.equal(calls[0].method, 'POST')
})

test('getMyAppointments 请求 GET /appointments/my 查看本人预约', async () => {
  replies.push({
    status: 200,
    data: [{ id: 'appt-1', status: 'PENDING' }],
  })

  const res = await getMyAppointments()
  assert.equal(res.length, 1)
  assert.equal(calls[0].url.endsWith('/appointments/my'), true)
})

test('cancelAppointment 请求 PATCH /appointments/:id/cancel 取消预约', async () => {
  replies.push({
    status: 200,
    data: { id: 'appt-1', status: 'CANCELLED' },
  })

  const res = await cancelAppointment('appt-1', '时间冲突')
  assert.equal(res.status, 'CANCELLED')
  assert.equal(calls[0].url.endsWith('/appointments/appt-1/cancel'), true)
  assert.equal(calls[0].method, 'PATCH')
  assert.equal(calls[0].data.reason, '时间冲突')
})
