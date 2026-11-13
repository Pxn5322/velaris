// @ts-check
import { defineConfig } from "@playwright/test";

/**
 * Screenshot regression harness for the administrator layouts.
 *
 * This is separate from the journey suite because the committed PNG baselines
 * are generated on Windows and compared by the Windows CI job. The Linux E2E
 * job ignores tests/visual. WebGL particles are hidden and time is frozen by
 * the spec, so a snapshot only changes when the layout or styles change.
 */
export default defineConfig({
  testDir: "./tests/visual",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  outputDir: "test-results/visual",
  reporter: process.env.CI
    ? [["list"], ["html", { outputFolder: "visual-report", open: "never" }]]
    : "list",
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.002,
      threshold: 0.2,
    },
  },
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3001",
    trace: "retain-on-failure",
  },
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFileName}/{arg}{ext}",
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "node ../../node_modules/next/dist/bin/next start -p 3001",
        cwd: "./apps/web",
        url: "http://localhost:3001",
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        stdout: "ignore",
        stderr: "pipe",
      },
});
