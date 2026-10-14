import { defineConfig, loadEnv } from 'vite'
import uniPlugin from '@dcloudio/vite-plugin-uni'
import { resolveApiBaseUrl } from './utils/api-config.js'

// uni 插件是 CJS 默认导出，兼容 Node ESM 包装。
const uni = uniPlugin.default || uniPlugin

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const apiBaseUrl = resolveApiBaseUrl(process.env.VITE_API_BASE_URL || env.VITE_API_BASE_URL, command === 'build')
  return {
    plugins: [uni()],
    define: { __API_BASE_URL__: JSON.stringify(apiBaseUrl) },
    server: { host: '127.0.0.1', port: 5174 }
  }
})
