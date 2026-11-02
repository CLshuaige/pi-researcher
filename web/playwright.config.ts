import { defineConfig } from '@playwright/test';
const testData = `/tmp/gewu-browser-${Date.now()}`;
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  expect: { timeout: 8000 },
  use: {
    baseURL: 'http://127.0.0.1:3101',
    viewport: { width: 1536, height: 1024 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    headless: true,
  },
  webServer: {
    command: 'npm run start',
    url: 'http://127.0.0.1:3101/api/health',
    reuseExistingServer: false,
    timeout: 45000,
    env: {
      GEWU_PORT: '3101',
      GEWU_DATA_DIR: testData,
      GEWU_WORKSPACE_DIR: `${testData}/workspaces`,
    },
  },
});
