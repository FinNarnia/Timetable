// Скриншоты экранов, для которых нужны данные эталонного набора (TypeScript-фикстуры).
// Использование: при запущенном `pnpm preview` — npx playwright test -c scripts/screenshots.config.ts
import base from '../playwright.config';

export default {
  ...base,
  testDir: '.',
  testMatch: '*.shots.ts',
  retries: 0,
  webServer: { ...base.webServer, reuseExistingServer: true },
};
