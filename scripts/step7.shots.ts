import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { createProfile, test } from '../e2e/fixtures';

// Шаг 7: вечернее уведомление, блок «Завтра», плашка о копии, настройки уведомлений.
const out = join('docs', 'screenshots', 'step-7');

async function tomorrowTasks(page: Page) {
  const form = page.getByRole('form', { name: 'Быстрое добавление задачи' });
  await form.getByRole('radio', { name: 'Завтра', exact: true }).check();
  for (const title of ['Позвонить маме', 'Купить подарок Лене', 'Записаться к врачу', 'Отправить отчёт']) {
    await form.getByLabel('Новая задача').fill(title);
    await form.getByLabel('Новая задача').press('Enter');
  }
}

for (const width of [360, 768, 1280]) {
  test(`уведомление ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.clock.install({ time: new Date('2026-10-14T19:58:00') });
    await createProfile(page);
    await tomorrowTasks(page);
    await page.clock.runFor('03:00');
    await page.getByTestId('reminder').waitFor();
    await page.clock.runFor('00:06');
    await page.screenshot({ path: join(out, `01-reminder-${width}.png`), fullPage: true });
    await page.getByTestId('tomorrow-block').locator('summary').click();
    await page.getByTestId('tomorrow-block').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(out, `02-tomorrow-block-${width}.png`), fullPage: true });
  });
}

test('настройки уведомлений 360', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await createProfile(page);
  await page.getByRole('link', { name: 'Настройки' }).click();
  await page.getByRole('heading', { name: 'Уведомления' }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(4500);
  await page.screenshot({ path: join(out, '03-settings-notifications-360.png'), fullPage: true });
});

test('плашка о копии 360', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.clock.install({ time: new Date('2026-10-01T10:00:00') });
  await createProfile(page);
  await page.clock.setSystemTime(new Date('2026-10-20T10:00:00'));
  await page.reload();
  await page.getByTestId('backup-banner').waitFor();
  await page.screenshot({ path: join(out, '04-backup-banner-360.png'), fullPage: true });
});
