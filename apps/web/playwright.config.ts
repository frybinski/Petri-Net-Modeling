import { defineConfig, devices } from '@playwright/test';

// Locally the browser can be taken from an existing installation, for example
// PNM_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm test:e2e
// In CI, `npx playwright install --with-deps chromium` provides the matching browser.
const executablePath = process.env.PNM_CHROMIUM_PATH;
// Another port can be chosen if 5173 is taken: PNM_E2E_PORT=5191 pnpm test:e2e
const port = Number(process.env.PNM_E2E_PORT ?? 5173);
// The tests of the server mode run against the real server process (with the built app and a
// stand-in for the language model server), see e2e/server/start-server.mjs.
const serverPort = Number(process.env.PNM_E2E_SERVER_PORT ?? port + 1000);
// PNM_E2E_NO_SERVER=1 leaves the tests of the server mode out, and with them the build of the app
// and the server that they need.
const withServer = process.env.PNM_E2E_NO_SERVER !== '1';

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
      testIgnore: '**/server/**',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 820 } },
    },
    ...(withServer
      ? [
          {
            name: 'server',
            testMatch: '**/server/*.spec.ts',
            use: {
              ...devices['Desktop Chrome'],
              viewport: { width: 1360, height: 820 },
              baseURL: `http://localhost:${serverPort}`,
            },
          },
        ]
      : []),
  ],
  webServer: [
    {
      command: `pnpm dev --port ${port} --strictPort`,
      url: `http://localhost:${port}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    ...(withServer
      ? [
          {
            // Builds the app and the server (unless PNM_E2E_SKIP_BUILD=1), then starts them.
            command: 'node e2e/server/start-server.mjs',
            url: `http://localhost:${serverPort}/api/health`,
            reuseExistingServer: false,
            timeout: 300_000,
            env: { PNM_E2E_PORT: String(port), PNM_E2E_SERVER_PORT: String(serverPort) },
          },
        ]
      : []),
  ],
});
