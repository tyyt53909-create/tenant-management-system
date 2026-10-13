import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const cli = require.resolve('@dcloudio/vite-plugin-uni/bin/uni.js')
// 官方 CLI 默认查找 src/。保留既有根目录页面，跨平台设置绝对输入目录。
process.env.UNI_INPUT_DIR = fileURLToPath(new URL('../', import.meta.url))
process.argv[1] = cli
await import(pathToFileURL(cli).href)
