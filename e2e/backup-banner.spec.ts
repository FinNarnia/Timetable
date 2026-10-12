import type { BrowserContext, Page } from '@playwright/test';
import { createProfile, expect, test } from './fixtures';

const at = (s: string) => new Date(s);

/** Результат запроса устойчивого хранилища задаётся тестом (п. 4.5): от него зависит срок напоминания. */
async function persistence(context: BrowserContext, persisted: boolean) {
  await context.addInitScript((value) => {
    const api = { persisted: () => Promise.resolve(value), persist: () => Promise.resolve(value) };
    // В WebKit под Linux navigator.storage может не быть — подставляем целиком.
    if (!navigator.storage) Object.defineProperty(Navigator.prototype, 'storage', { value: api, configurable: true });
    else Object.assign(navigator.storage, api);
  }, persisted);
}

async function jumpTo(page: Page, iso: string) {
  await page.clock.setSystemTime(at(iso));
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: /, Анна$/ })).toBeVisible();
}

const banner = (page: Page) => page.getByTestId('backup-banner');

test.describe('плашка о резервной копии (п. 4.3, 4.5)', () => {
  test('без устойчивого хранилища: через 7 дней без копии, после копии — через 14 дней; «Не сейчас» — на 7 дней', async ({ page, context }) => {
    await persistence(context, false);
    await page.clock.install({ time: at('2026-10-01T10:00:00') });
    await createProfile(page);
    await expect(banner(page)).toHaveCount(0);

    await jumpTo(page, '2026-10-08T10:00:00'); // 7 дней — ещё нет
    await expect(banner(page)).toHaveCount(0);
    await jumpTo(page, '2026-10-09T10:00:00'); // 8 дней
    await expect(banner(page)).toContainText('Резервная копия ещё не сохранялась');

    const [download] = await Promise.all([page.waitForEvent('download'), banner(page).getByRole('button', { name: 'Сохранить копию' }).click()]);
    expect(download.suggestedFilename()).toBe('moy-ritm-2026-10-09.json');
    await expect(banner(page)).toHaveCount(0);

    await jumpTo(page, '2026-10-23T10:00:00'); // 14 дней после копии — ещё нет
    await expect(banner(page)).toHaveCount(0);
    await jumpTo(page, '2026-10-24T10:00:00'); // 15 дней
    await expect(banner(page)).toContainText('Давно не сохраняли резервную копию');

    await banner(page).getByRole('button', { name: 'Не сейчас' }).click();
    await expect(banner(page)).toHaveCount(0);
    await jumpTo(page, '2026-10-30T10:00:00'); // 6 дней после закрытия
    await expect(banner(page)).toHaveCount(0);
    await jumpTo(page, '2026-10-31T10:00:00'); // 7 дней
    await expect(banner(page)).toBeVisible();
  });

  test('с устойчивым хранилищем: после копии — через 30 дней', async ({ page, context }) => {
    await persistence(context, true);
    await page.clock.install({ time: at('2026-09-01T10:00:00') });
    await createProfile(page);
    await jumpTo(page, '2026-09-10T10:00:00');
    await Promise.all([page.waitForEvent('download'), banner(page).getByRole('button', { name: 'Сохранить копию' }).click()]);
    await jumpTo(page, '2026-09-26T10:00:00'); // 16 дней — без устойчивого хранилища уже была бы плашка
    await expect(banner(page)).toHaveCount(0);
    await jumpTo(page, '2026-10-10T10:00:00'); // 30 дней
    await expect(banner(page)).toHaveCount(0);
    await jumpTo(page, '2026-10-11T10:00:00'); // 31 день
    await expect(banner(page)).toContainText('Давно не сохраняли резервную копию');
  });
});
