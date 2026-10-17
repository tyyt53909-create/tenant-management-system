import { defineConfig, devices } from '@playwright/test';

/**
 * OPT-24 / T197：管理后台关键流程 UI 测试。
 *
 * 运行前置（与 CI admin-ui job 一致）：
 *   后端  -> http://127.0.0.1:3000（NODE_ENV=test，已迁移 + 播种）
 *   前端  -> VITE_API_BASE_URL=http://127.0.0.1:3000/api npm run build && npx vite preview --port 4173
 *   本地  -> E2E_BASE_URL / E2E_API_BASE_URL 可覆盖地址（本地后端多为 :3100）
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'flows',
      testMatch: /.*\.spec\.ts/,
      // 注意：flows 不复用 setup 的 storageState，每个用例独立登录（见 fixtures.loginAsAdmin）
    },
  ],
});
