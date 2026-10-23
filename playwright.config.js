// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config for the real Next.js app in apps/web.
 *
 * Journeys live in tests/ and target the production build of apps/web. The
 * webServer block builds apps/web once, then serves it with `next start`, so
 * CI exercises the same production bundle the deployment runs. AC-F01 journeys
 * are covered by tests/landing.spec.js (docs/TESTING.md section 3).
 *
 * The server command invokes the `next` binary directly through node with an
 * absolute path. Wrapping it in `npm run` stalls under Playwright's shell on
 * Windows (the readiness probe never succeeds), while direct node invocation
 * starts in ~150ms. This path is identical on Linux CI.
 *
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3001',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'node ../../node_modules/next/dist/bin/next start -p 3001',
        cwd: './apps/web',
        url: 'http://localhost:3001',
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
});
