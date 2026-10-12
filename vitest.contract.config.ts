import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/contract/**/*.test.ts'],
    globalSetup: ['test/contract/setup.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 300_000,
  },
});
