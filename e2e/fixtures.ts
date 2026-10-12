import { test as base, expect, type Locator, type Page } from '@playwright/test';

/**
 * Общая фикстура: любая ошибка в консоли браузера или необработанное исключение
 * (включая нарушения CSP) валит тест — DoD п. 16.7.
 */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
      });
      page.on('pageerror', (err) => errors.push(err.message));
      await use(errors);
      expect(errors, 'ошибки в консоли браузера').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/**
 * Выбор кнопки-«таблетки» (радио или флажок внутри label) так, как это делает человек: щелчком по видимой подписи.
 * Состояние поля проверяется после щелчка. WebKit в CI не переключает скрытое поле при щелчке в его центр (locator.check).
 */
export async function pick(input: Locator, checked = true) {
  if ((await input.isChecked()) === checked) return;
  await input.locator('xpath=ancestor::label[1]').click();
  await expect(input).toBeChecked({ checked });
}

/**
 * Повторное открытие приложения в новой вкладке того же контекста вместо page.reload(): WebKit в CI падает
 * или зависает на перезагрузке страницы с подменёнными часами. Часы общие для контекста, данные — в IndexedDB.
 */
export async function reopen(page: Page, errors: string[]): Promise<Page> {
  const fresh = await page.context().newPage();
  fresh.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  fresh.on('pageerror', (err) => errors.push(err.message));
  await fresh.goto(page.url());
  await page.close();
  return fresh;
}

export async function createProfile(page: Page, name = 'Анна') {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Мой ритм' })).toBeVisible();
  await page.getByLabel('Как вас зовут?').fill(name);
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(page.getByRole('heading', { level: 1, name: new RegExp(`, ${name}$`) })).toBeVisible();
}

export async function openSettings(page: Page) {
  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Настройки' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Настройки' })).toBeVisible();
}

/** Скачивает резервную копию и возвращает её разобранное содержимое. */
export async function downloadBackup(page: Page): Promise<{ fileName: string; json: Record<string, unknown> & { data: Record<string, unknown> } }> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Скачать резервную копию' }).first().click(),
  ]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return { fileName: download.suggestedFilename(), json: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
}

export async function chooseBackupFile(page: Page, buttonName: string, file: { name: string; buffer: Buffer }) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: buttonName }).click()]);
  await chooser.setFiles({ name: file.name, mimeType: 'application/json', buffer: file.buffer });
}

/**
 * Первый запуск с данными случая эталонного набора отчётов (fixtures/reports): часы ставятся на «сегодня» случая 15:00,
 * данные восстанавливаются из сгенерированной резервной копии.
 */
export async function seedReportCase(page: Page, caseId: string) {
  const { REPORT_CASES, caseData } = await import('../tests/reportFixtures');
  const c = REPORT_CASES.find((x) => x.id === caseId)!;
  const [y, m, d] = c.today.split('-').map(Number) as [number, number, number];
  await page.clock.install({ time: new Date(y, m - 1, d, 15, 0) });
  const file = { format: 'moy-ritm-backup', schemaVersion: 1, appVersion: 'fixture', exportedAt: new Date(y, m - 1, d, 14, 0).toISOString(), data: caseData(c) };
  await page.goto('/');
  await chooseBackupFile(page, 'Восстановить из резервной копии', { name: `${caseId}.json`, buffer: Buffer.from(JSON.stringify(file)) });
  await page.getByRole('dialog', { name: 'Восстановить из копии?' }).getByRole('button', { name: 'Восстановить' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /, Анна$/ })).toBeVisible();
}

/**
 * Пороги производительности п. 15.2. Эталонное окружение — задание perf в GitHub Actions (PERF_STRICT=1): там пороги ТЗ.
 * В остальных прогонах — защита от грубой регрессии: скорость IndexedDB в контейнерах сильно плавает.
 */
export const PERF_STRICT = process.env.PERF_STRICT === '1';
export const perfLimit = (strict: number, loose: number): number => (PERF_STRICT ? strict : loose);
