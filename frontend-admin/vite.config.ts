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
        // dts 暂不生成：生成后 vue-tsc 会首次拿到 Element Plus 的插槽类型，
        // 从而对 11 个视图里既有的 `#default="{ row }"` 报 79 处 DefaultRow 类型错误
        // （属历史宽松写法，非本次改动引入）。修完那些插槽标注再打开，见 T204 交接记录 §5。
        dts: false,
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
