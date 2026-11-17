import { defineConfig, devices } from '@playwright/test';

// E2E runs the production build against a real backend. Start one first (any Node backend's
// `docker compose --profile app up -d`); Playwright builds the app and serves it with
// `vite preview`. Not the dev server: its on-demand dependency optimisation can reload the page
// mid-test the first time a lazy route loads.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    // The board's entrance animations move buttons for ~0.7 s; a test can click faster than a
    // person and miss. The app turns animations off for reduced motion, so ask for that.
    contextOptions: { reducedMotion: 'reduce' },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
