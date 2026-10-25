import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts', '../shared/src/**/*.spec.ts', 'test/integration/guard.spec.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.git/**',
      '**/coverage/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      thresholds: {
        statements: 85,
        branches: 72,
        lines: 85,
        functions: 80,
        // 结算核心文件：分支覆盖率 ≥90%（OPT-23 / T196）
        'src/modules/bills/bills.service.ts': { branches: 90 },
        'src/modules/bills/bill-payment.service.ts': { branches: 90 },
        'src/modules/bills/bill-late-fee.service.ts': { branches: 90 },
        'src/modules/bills/bill-receipt.service.ts': { branches: 90 },
        'src/modules/prepay/prepay.service.ts': { branches: 90 },
        'src/modules/meters/meter-billing.service.ts': { branches: 90 },
        'src/modules/meters/meter-reading.service.ts': { branches: 90 },
        'src/modules/meters/meter-batch-reading.service.ts': { branches: 90 },
      },
    },
  },
});
