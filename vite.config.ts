/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };
import { SECURITY_HEADERS } from './scripts/security-headers.mjs';

// Заголовки безопасности — общие для preview и хостинга (scripts/security-headers.mjs, п. 15.1).
// В режиме dev они не ставятся: Vite использует встроенные скрипты для горячей перезагрузки.

// Модульные тесты — в часовом поясе из TZ (по умолчанию Москва); оба пояса — pnpm test:tz.
process.env.TZ ??= 'Europe/Moscow';

export default defineConfig({
  // Путь публикации: на хостинге — /timetable/ (pnpm build:deploy), локально и в тестах — корень.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  preview: {
    headers: SECURITY_HEADERS,
  },
  // Без встраивания файлов в data: — их блокирует CSP font-src/img-src 'self'.
  build: { assetsInlineLimit: 0 },
  worker: { format: 'es' },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
    // Покрытие Domain ≥ 90% (п. 16.1).
    coverage: { include: ['src/domain/**'], thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 } },
  },
});
