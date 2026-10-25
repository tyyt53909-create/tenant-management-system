import test from 'node:test'
import assert from 'node:assert/strict'
import { installPrivacyHandler, privacySummary, PRIVACY_ITEMS, withPrivacy } from '../utils/privacy.js'

test('隐私条目覆盖实际使用的接口，文案包含用途', () => {
  assert.deepEqual(
    PRIVACY_ITEMS.map((item) => item.api),
    ['chooseImage', 'setClipboardData', 'saveImageToPhotosAlbum'],
  )
  const summary = privacySummary()
  assert.equal(summary.title, '隐私保护提示')
  for (const item of PRIVACY_ITEMS) {
    assert.ok(summary.content.includes(item.label), `缺少条目 ${item.label}`)
    assert.ok(summary.content.includes(item.purpose))
  }
  assert.equal(summary.confirmText, '同意并继续')
})

test('注册隐私回调后按用户选择返回 agree/disagree', () => {
  let handler = null
  globalThis.uni = {
    onNeedPrivacyAuthorization: (fn) => {
      handler = fn
    },
  }
  const decisions = []
  const shown = []
  // 自定义展示：直接把用户选择回传给基础库（真实实现用 uni.showModal）
  assert.equal(
    installPrivacyHandler(({ resolve }) => {
      shown.push('modal')
      resolve({ event: 'agree' })
    }),
    true,
  )
  assert.ok(handler)
  handler((payload) => decisions.push(payload.event))
  assert.deepEqual(shown, ['modal'])
  assert.deepEqual(decisions, ['agree'])
})

test('平台不支持隐私回调时返回 false，不抛错', () => {
  globalThis.uni = {}
  assert.equal(installPrivacyHandler(), false)
})

test('withPrivacy 在用户取消时返回 null，其它错误继续抛出', async () => {
  assert.equal(await withPrivacy(async () => null), null)
  assert.equal(
    await withPrivacy(async () => {
      throw Object.assign(new Error('x'), { errMsg: 'chooseImage:fail privacy permission is not authorized' })
    }),
    null,
  )
  assert.equal(
    await withPrivacy(async () => {
      throw Object.assign(new Error('x'), { errMsg: 'chooseImage:fail cancel' })
    }),
    null,
  )
  await assert.rejects(
    withPrivacy(async () => {
      throw new Error('disk full')
    }),
    /disk full/,
  )
})
