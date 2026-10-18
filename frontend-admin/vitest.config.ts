import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/** 单元测试配置：e2e/ 由 Playwright 执行，必须排除（T197）。 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.spec.ts', 'vite.config.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
  },
});
