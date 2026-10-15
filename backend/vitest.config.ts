import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.git/**',
      '**/coverage/**',
    ],
  },
});
