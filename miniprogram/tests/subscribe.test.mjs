import test from 'node:test'
import assert from 'node:assert/strict'
import { requestAndReportSubscribe } from '../utils/subscribe.js'

test('空模板列表直接返回空对象', async () => {
  const res = await requestAndReportSubscribe([])
  assert.deepEqual(res, {})
})

test('非微信环境直接返回空对象', async () => {
  const oldUni = globalThis.uni
  globalThis.uni = undefined
  try {
    const res = await requestAndReportSubscribe(['tmpl-1'])
    assert.deepEqual(res, {})
  } finally {
    globalThis.uni = oldUni
  }
})

test('模拟微信环境用户授权上报', async () => {
  const oldUni = globalThis.uni
  globalThis.uni = {
    requestSubscribeMessage: ({ tmplIds, success }) => {
      success({
        [tmplIds[0]]: 'accept',
        errMsg: 'requestSubscribeMessage:ok',
      })
    },
  }
  try {
    const res = await requestAndReportSubscribe(['tmpl-bill-001'])
    assert.equal(res['tmpl-bill-001'], 'accept')
  } finally {
    globalThis.uni = oldUni
  }
})

test('模拟微信环境用户拒绝或弹窗失败', async () => {
  const oldUni = globalThis.uni
  globalThis.uni = {
    requestSubscribeMessage: ({ fail }) => {
      fail({ errMsg: 'requestSubscribeMessage:fail cancel' })
    },
  }
  try {
    const res = await requestAndReportSubscribe(['tmpl-bill-001'])
    assert.deepEqual(res, {})
  } finally {
    globalThis.uni = oldUni
  }
})
