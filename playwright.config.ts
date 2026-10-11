import { defineConfig, devices } from '@playwright/test';

// Сквозные тесты идут против production-сборки (vite preview) с заголовком CSP.
// По умолчанию — Chromium; все три движка (п. 16.4): E2E_ALL_BROWSERS=1 pnpm test:e2e.
const allBrowsers = process.env.E2E_ALL_BROWSERS === '1';

// Часовой пояс один для Node (часы тестов) и браузера. Проверяется в двух поясах (п. 16): pnpm test:e2e:tz.
process.env.TZ ??= 'Europe/Moscow';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    locale: 'ru-RU',
    timezoneId: process.env.TZ,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...(allBrowsers
      ? [
          { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
          { name: 'webkit', use: { ...devices['Desktop Safari'] } },
        ]
      : []),
  ],
  webServer: {
    command: 'pnpm build && pnpm preview',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
