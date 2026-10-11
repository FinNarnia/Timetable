import { defineConfig, devices } from '@playwright/test';

// Проверка сборки для хостинга: pnpm build:deploy → Apache с .htaccess → приложение по адресу /timetable/.
process.env.TZ ??= 'Europe/Moscow';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github']] : [['list']],
  use: { baseURL: 'http://localhost:8080', locale: 'ru-RU', timezoneId: process.env.TZ },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node scripts/build-deploy.mjs && node deploy/serve-apache.mjs',
    cwd: '..',
    url: 'http://localhost:8080/timetable/',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
