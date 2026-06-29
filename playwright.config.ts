import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  outputDir: './docs/test_results/artifacts',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npm run dev --prefix backend',
      url: 'http://localhost:3001/socket.io/?EIO=4&transport=polling',
      // Bypass create-burst / per-IP rate limits: the suite drives many room creates
      // from one subject (shared localhost IP/UA, no fingerprint). Only applies when
      // Playwright starts the backend — if a backend is already running on 3001 it is
      // reused as-is, so start it with E2E_DISABLE_RATE_LIMIT=1 for E2E runs.
      env: { E2E_DISABLE_RATE_LIMIT: '1' },
      reuseExistingServer: true,
      timeout: 15000,
    },
    {
      command: 'npm run dev --prefix frontend',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 15000,
    },
  ],
});
