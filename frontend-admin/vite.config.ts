import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const apiTarget = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3100'

  return {
    plugins: [
      vue(),
      // 组件按需自动引入：不再在 main.ts 里 app.use(ElementPlus) 全量注册。
      // importStyle: false —— 样式仍走 element-plus/dist/index.css（见 main.ts 注释：
      // 必须在 element-variables.css 之前加载才能被栖居主题覆盖），这里只做 JS 按需。
      Components({
        resolvers: [ElementPlusResolver({ importStyle: false })],
        // 生成元件/指令的全局类型声明（src/components.d.ts，已纳入版本管理），
        // 让 vue-tsc 能对 <el-*> 做真实类型检查（含 v-loading 等指令）。
        // 开启前提：11 个视图的 el-table-column 插槽已补齐显式标注（T205），
        // 否则 row 会推断为 DefaultRow 并报大量 TS2345，见 T204 交接记录 §四。
        dts: 'src/components.d.ts',
      }),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    server: {
      // 明确监听 IPv4 回环，避免 macOS 只绑定 ::1 导致 127.0.0.1 无法打开。
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true
        }
      }
    }
  }
})
