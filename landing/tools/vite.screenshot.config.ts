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
const adminRoot = fileURLToPath(new URL('../../frontend-admin/', import.meta.url));

export default defineConfig({
  root: adminRoot,
  // 隔离 .env：不读 frontend-admin/.env.local（那里直连真实后端），改用 landing/tools/env/
  envDir: fileURLToPath(new URL('./env/', import.meta.url)),
  plugins: [vue()],
  resolve: { alias: { '@': path.join(adminRoot, 'src') } },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:3101', changeOrigin: true } },
  },
});
