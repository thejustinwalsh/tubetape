import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.ladle/test',
  outputDir: '.ladle/test-results',
  snapshotPathTemplate: '.ladle/test/snapshots/{testFilePath}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { outputFolder: './.ladle/playwright-report' }]],
  use: {
    baseURL: 'http://localhost:61000',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'bun run ladle:build && bun run ladle:preview',
    url: 'http://localhost:61000',
    reuseExistingServer: !process.env.CI,
    timeout: 30 * 1000,
  },
  projects: [
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 }
      },
    },
  ],
});
