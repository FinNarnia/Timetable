import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chooseBackupFile, expect, test } from '../e2e/fixtures';

// Сборка для fin-narnia.online/timetable/ на Apache с .htaccess (п. 15.1, 17). Ошибки консоли, включая CSP, валят тест.
const BASE = '/timetable/';
const sample = readFileSync(resolve('fixtures/backups/sample.json'));

test('заголовки безопасности и кэширование', async ({ request }) => {
  const page = await request.get(BASE);
  expect(page.status()).toBe(200);
  const h = page.headers();
  expect(h['content-security-policy']).toContain("script-src 'self'");
  expect(h['content-security-policy']).not.toContain('unsafe-inline');
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['referrer-policy']).toBe('no-referrer');
  expect(h['cache-control']).toBe('no-cache');
  const html = await page.text();
  const script = html.match(/src="(\/timetable\/assets\/[^"]+\.js)"/)?.[1];
  expect(script, 'скрипт подключён с путём /timetable/').toBeTruthy();
  const asset = await request.get(script!);
  expect(asset.headers()['cache-control']).toContain('immutable');
  expect(asset.headers()['content-type']).toContain('javascript');
  // Корень сайта не тронут.
  expect(await (await request.get('/')).text()).toContain('Главная сайта');
});

test('первый запуск, навигация и прямые ссылки внутри /timetable/', async ({ page }) => {
  await page.goto(BASE);
  await page.getByLabel('Как вас зовут?').fill('Анна');
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /, Анна$/ })).toBeVisible();

  const nav = page.getByRole('navigation', { name: 'Основная навигация' });
  await expect(nav.getByRole('link', { name: 'Отчёты' })).toHaveAttribute('href', '/timetable/reports');
  await nav.getByRole('link', { name: 'Отчёты' }).click();
  await expect(page).toHaveURL(/\/timetable\/reports$/);
  await page.reload(); // прямая ссылка обслуживается index.html
  await expect(page.getByRole('heading', { level: 1, name: 'Отчёты' })).toBeVisible();

  for (const [path, title] of [
    ['upcoming', 'Предстоящие'],
    ['habits', 'Привычки'],
    ['settings', 'Настройки'],
  ]) {
    await page.goto(`${BASE}${path}`);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  }
  await page.goto(`${BASE}no-such-page`);
  await expect(page).toHaveURL(/\/timetable\/?$/); // неизвестный адрес → «Сегодня»
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: /, Анна$/ })).toBeVisible();

  // Проверка копии в Web Worker под CSP и восстановление.
  await page.goto(`${BASE}settings`);
  await chooseBackupFile(page, 'Восстановить из копии', { name: 'sample.json', buffer: sample });
  await page.getByRole('dialog', { name: 'Восстановить из копии?' }).getByRole('button', { name: 'Восстановить' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /, Мария$/ })).toBeVisible();
  // Шрифты загружаются со своего адреса.
  expect(await page.evaluate(async () => (await document.fonts.ready, [...document.fonts].some((f) => f.status === 'loaded')))).toBe(true);
});
