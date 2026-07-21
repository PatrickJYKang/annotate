import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;
const webPort = Number(process.env.PLAYWRIGHT_WEB_PORT ?? 3000);
const sidecarPort = Number(process.env.PLAYWRIGHT_SIDECAR_PORT ?? 8321);
const baseUrl = `http://127.0.0.1:${webPort}`;
const sidecarUrl = `http://127.0.0.1:${sidecarPort}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: 1,
  timeout: 60_000,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],
  use: {
    baseURL: baseUrl,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    cwd: '..',
    env: {
      ...process.env,
      PORT: String(webPort),
      SIDECAR_PORT: String(sidecarPort),
      NEXT_PUBLIC_SIDECAR_URL: sidecarUrl,
      NEXT_DIST_DIR: '.next-playwright',
    },
    url: baseUrl,
    reuseExistingServer: !isCI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
