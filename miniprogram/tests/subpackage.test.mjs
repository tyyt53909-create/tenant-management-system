import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'

const pages = JSON.parse(await readFile(new URL('../pages.json', import.meta.url), 'utf8'))

test('主包只保留 tab 与首屏页面，其余进 packageA 分包', () => {
  const main = pages.pages.map((page) => page.path)
  assert.deepEqual(main, [
    'pages/index/index',
    'pages/cleaning/cleaning',
    'pages/login/login',
    'pages/bills/bills',
    'pages/maintenance/maintenance',
    'pages/profile/profile',
  ])
  assert.deepEqual(
    pages.subPackages.map((group) => group.root),
    ['packageA'],
  )
  const sub = pages.subPackages[0].pages.map((page) => page.path).sort()
  assert.deepEqual(sub, [
    'account/account',
    'bill-detail/bill-detail',
    'contract/contract',
    'maintenance/detail',
    'notifications/notifications',
    'theme/theme',
  ])
})

test('分包页面文件真实存在于 packageA 下', async () => {
  for (const page of pages.subPackages[0].pages) {
    const file = new URL(`../packageA/${page.path}.vue`, import.meta.url)
    assert.ok((await stat(file)).isFile(), `缺少 ${page.path}.vue`)
  }
})

test('首屏预下载分包，避免第一次点开白屏', () => {
  assert.equal(pages.preloadRule['pages/index/index'].packages[0], 'packageA')
  assert.equal(pages.preloadRule['pages/profile/profile'].packages[0], 'packageA')
})

test('页面跳转全部指向存在的包内路径', async () => {
  const main = new Set(pages.pages.map((page) => `/${page.path}`))
  const sub = new Set(
    pages.subPackages.flatMap((group) => group.pages.map((page) => `/${group.root}/${page.path}`)),
  )
  const sources = [
    '../pages/bills/bills.vue',
    '../pages/maintenance/maintenance.vue',
    '../pages/index/index.vue',
    '../pages/profile/profile.vue',
    '../pages/cleaning/cleaning.vue',
    '../components/ContactCardModal.vue',
  ]
  for (const source of sources) {
    const code = await readFile(new URL(source, import.meta.url), 'utf8')
    for (const match of code.matchAll(/'(\/(?:pages|packageA)\/[a-zA-Z0-9/_-]+)'/g)) {
      const target = match[1]
      assert.ok(main.has(target) || sub.has(target), `${source} 指向不存在的页面 ${target}`)
    }
  }
})
