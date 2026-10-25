import { readFile } from 'node:fs/promises'

/**
 * 页面源码定位（FE-02 / T287）：主包在 `pages/`，分包在 `packageA/`。
 * 测试只关心「页面脚本行为」，不应该因为分包迁移而逐个改路径。
 */
export async function resolvePageUrl(path) {
  for (const root of ['../pages/', '../packageA/']) {
    const url = new URL(`${root}${path}.vue`, import.meta.url)
    try {
      await readFile(url)
      return url
    } catch {
      // 换下一个根目录
    }
  }
  throw new Error(`页面不存在（主包与 packageA 均未找到）: ${path}`)
}
