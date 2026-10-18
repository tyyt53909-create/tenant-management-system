// 仅用于落地页截图：把前台指向隔离的演示后端（:3101 / tenant_demo 库）
// 用法：cd frontend-admin && npx vite --config ../landing/tools/vite.screenshot.config.ts --port 5174
// 说明：配置文件位于仓库外层的 landing/tools/，Node 无法从这里解析裸包名，
//       因此用 createRequire 以 frontend-admin 为基准解析 vite / @vitejs/plugin-vue。
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const requireFromAdmin = createRequire(new URL('../../frontend-admin/package.json', import.meta.url));
const { defineConfig } = requireFromAdmin('vite');
const vue = requireFromAdmin('@vitejs/plugin-vue').default;
// 这个包通过 require 取回的就是函数本身（没有 .default 包装），与 ESM import 写法不同。
const Components = requireFromAdmin('unplugin-vue-components/vite');
const { ElementPlusResolver } = requireFromAdmin('unplugin-vue-components/resolvers');
const adminRoot = fileURLToPath(new URL('../../frontend-admin/', import.meta.url));

export default defineConfig({
  root: adminRoot,
  // 隔离 .env：不读 frontend-admin/.env.local（那里直连真实后端），改用 landing/tools/env/
  envDir: fileURLToPath(new URL('./env/', import.meta.url)),
  plugins: [
    vue(),
    // 与 vite.config.ts 保持一致：T204 起 Element Plus 改为按需自动引入，
    // 缺了这组插件 el-* 组件全部无法解析，截出来的页面是空的。
    Components({ resolvers: [ElementPlusResolver({ importStyle: false })], dts: false }),
  ],
  resolve: { alias: { '@': path.join(adminRoot, 'src') } },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:3101', changeOrigin: true } },
  },
});
