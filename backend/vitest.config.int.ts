import { defineConfig } from 'vitest/config';

/**
 * QLT-01 / T255：真实 PostgreSQL 集成测试。
 *
 * 与 e2e 的区别：
 * - 用例共用同一个测试库，每个用例前 TRUNCATE（串行执行，文件不并行）；
 * - 不使用 Prisma mock，断言真实约束（唯一索引、事务、外键）与 HTTP 行为。
 */
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/integration/**/*.int-spec.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
