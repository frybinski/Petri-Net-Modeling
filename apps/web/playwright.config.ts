import { defineConfig, devices } from '@playwright/test';

// Locally the browser can be taken from an existing installation, for example
// PNM_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm test:e2e
// In CI, `npx playwright install --with-deps chromium` provides the matching browser.
const executablePath = process.env.PNM_CHROMIUM_PATH;
// Another port can be chosen if 5173 is taken: PNM_E2E_PORT=5191 pnpm test:e2e
const port = Number(process.env.PNM_E2E_PORT ?? 5173);

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
    viewport: { width: 1360, height: 820 },
    acceptDownloads: true,
    // Node pop-in and pulse animations would make bounding boxes move while a test measures them.
    reducedMotion: 'reduce',
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: ['--no-sandbox'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 820 } },
    },
  ],
  webServer: {
    command: `pnpm dev --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
