import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // One worker: parallel headless WebGL contexts contend for the GPU, and the
  // frame-time collapse makes game time drift from wall time, flaking timed
  // gameplay phases and screenshot baselines.
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:5188',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Manage each long-running process directly. On Windows, wrapping both in
  // concurrently can leave the Vite/tsx grandchildren alive after Playwright exits.
  webServer: [
    {
      command: 'node --import tsx server/index.ts',
      url: 'http://127.0.0.1:5190/healthz',
      reuseExistingServer: true,
      timeout: 20_000,
    },
    {
      command: 'node node_modules/vite/bin/vite.js',
      url: 'http://127.0.0.1:5188',
      reuseExistingServer: true,
      timeout: 20_000,
    },
  ],
  projects: [
    {
      name: 'desktop-chrome',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium',
        // Reuse the user's installed stable Chrome. This avoids downloading a
        // second Playwright-managed Chromium build.
        channel: 'chrome',
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: 'narrow-chrome',
      use: {
        ...devices['iPhone 13'],
        browserName: 'chromium',
        // This project checks responsive framing and HUD fit in a phone-sized
        // context; the keyboard-only MVP does not claim Safari/touch support.
        channel: 'chrome',
      },
    },
  ],
});
