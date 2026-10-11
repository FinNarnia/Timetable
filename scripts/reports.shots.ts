import { join } from 'node:path';
import { seedReportCase, test } from '../e2e/fixtures';

// Шаг 6: отчёты на данных случая R18 эталонного набора (сегодня — ср, 14 окт 2026).
const out = join('docs', 'screenshots', 'step-6');

for (const width of [360, 768, 1280]) {
  test(`отчёты ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await seedReportCase(page, 'R18');
    await page.waitForTimeout(5500); // уведомление о восстановлении скрывается
    await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Отчёты' }).click();
    await page.getByTestId('summary-tasks').waitFor();
    await page.screenshot({ path: join(out, `01-week-current-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: '← Раньше' }).click();
    await page.getByRole('heading', { name: 'пн, 5 окт — вс, 11 окт 2026' }).waitFor();
    await page.screenshot({ path: join(out, `02-week-previous-${width}.png`), fullPage: true });
    await page.getByRole('radio', { name: 'Месяц' }).check();
    await page.getByRole('button', { name: '6 октября: 2 из 5, 40%' }).click();
    await page.screenshot({ path: join(out, `03-month-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: '← Раньше' }).click();
    await page.getByRole('heading', { name: 'Сентябрь 2026' }).waitFor();
    await page.screenshot({ path: join(out, `04-month-empty-${width}.png`), fullPage: true });
  });
}
