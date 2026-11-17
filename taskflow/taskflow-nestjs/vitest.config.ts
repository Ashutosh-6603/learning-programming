import { defineConfig } from 'vitest/config';
import { testEnv } from './test/test-env.js';

export default defineConfig({
  test: {
    env: testEnv,
    include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    globalSetup: ['test/global-setup.ts'],
    // Decorators store their metadata through this polyfill; Nest loads it in the app,
    // and unit tests that never import Nest need it too.
    setupFiles: ['reflect-metadata'],
    // Integration tests share one database, so test files run one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/main.ts',
        'src/worker.ts',
        'src/migrate.ts',
        'src/seed.ts',
        'src/database/data-source.ts',
        'src/database/migrations/**',
      ],
      reporter: ['text-summary', 'html', 'lcov'],
    },
  },
});
