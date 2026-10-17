import { defineConfig } from '@playwright/test';

/**
 * E2E (PLAN §12) against the API and the web app as `pnpm build` left them, started here; the API
 * reads apps/api/.env, so the local Postgres and RustFS. Locally, servers already running on
 * those ports (`pnpm dev`) are used instead.
 */
export default defineConfig({
  testDir: '.',
  timeout: 240_000,
  // Pages refetch after each change, and the business date moves with a page refresh.
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://localhost:3000',
    // The installed Chrome, as the Playwright CLI uses: no browser to download.
    channel: 'chrome',
    viewport: { width: 1440, height: 960 },
    // The app's reduced-motion branch: nothing is caught mid-animation.
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @joinpath/api start',
      url: 'http://localhost:3001/api/health',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'pnpm --filter @joinpath/web start',
      url: 'http://localhost:3000/login',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
