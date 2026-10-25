import assert from 'node:assert/strict'
import { readFile, stat, readdir } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const pages = JSON.parse(await readFile(new URL('pages.json', root)))
// FE-02 / T287：主页 + packageA 分包的完整页面清单
const pageEntries = [
  ...pages.pages,
  ...(pages.subPackages || []).flatMap((group) =>
    group.pages.map((page) => ({ ...page, path: `${group.root}/${page.path}` })),
  ),
]
const mp = new URL('dist/build/mp-weixin/', root)
const h5 = new URL('dist/build/h5/', root)
const app = JSON.parse(await readFile(new URL('app.json', mp)))
// 构建产物把分包页面放在 `subPackages[].pages`（相对 root），与主包 `pages` 分开登记
const builtPages = new Set([
  ...app.pages,
  ...(app.subPackages || []).flatMap((group) =>
    group.pages.map((page) => `${group.root}/${typeof page === 'string' ? page : page.path}`),
  ),
])
for (const page of pageEntries) {
  assert.ok(builtPages.has(page.path), `微信构建缺少页面 ${page.path}`)
  for (const extension of ['js', 'json', 'wxml', 'wxss']) {
    assert.ok((await stat(new URL(`${page.path}.${extension}`, mp))).isFile())
  }
  const source = await readFile(new URL(`${page.path}.vue`, root), 'utf8')
  for (const [, icon] of source.matchAll(/src="\/static\/([^"]+)"/g)) {
    assert.ok((await stat(new URL(`static/${icon}`, mp))).size > 0)
    assert.ok((await stat(new URL(`static/${icon}`, h5))).size > 0)
  }
}
for (const item of app.tabBar.list) {
  for (const icon of [item.iconPath, item.selectedIconPath]) {
    const data = await readFile(new URL(icon, mp))
    assert.ok(data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
  }
}
assert.ok((await readFile(new URL('index.html', h5), 'utf8')).includes('id="app"'))
async function checkScripts(directory) {
  let scripts = 0
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = new URL(item.name + (item.isDirectory() ? '/' : ''), directory)
    if (item.isDirectory()) scripts += await checkScripts(path)
    else if (item.name.endsWith('.js')) {
      assert.ok(!(await readFile(path, 'utf8')).includes('http://localhost:3000/api'), '生产产物仍有本地 API 回落')
      scripts++
    }
  }
  return scripts
}
assert.ok(await checkScripts(mp))
assert.ok(await checkScripts(h5))
console.log(`微信 ${pageEntries.length} 页（含分包）及 PNG/H5 资源齐全，生产产物无本地 API 回落`)
