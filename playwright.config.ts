import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  reporter: [['list'], ['json', { outputFile: 'docs/verification/iteration-02/browser-tests.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:5180',
    headless: true,
    channel: 'chromium',
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5180',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
