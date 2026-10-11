import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { chooseBackupFile, createProfile, downloadBackup, expect, openSettings, test } from './fixtures';

// Необязательные API выключены (п. 15.3): приложение работает, опираясь на транзакции IndexedDB и события окна.
type Api = 'locks' | 'broadcast' | 'persist' | 'notification' | 'worker';

async function disable(context: BrowserContext, apis: Api[]) {
  await context.addInitScript((list: string[]) => {
    const w = window as unknown as Record<string, unknown>;
    if (list.includes('locks')) Object.defineProperty(Navigator.prototype, 'locks', { get: () => undefined, configurable: true });
    if (list.includes('broadcast')) delete w.BroadcastChannel;
    if (list.includes('notification')) delete w.Notification;
    if (list.includes('worker')) delete w.Worker;
    if (list.includes('persist') && navigator.storage) {
      Object.defineProperty(navigator.storage, 'persist', { value: undefined, configurable: true });
      Object.defineProperty(navigator.storage, 'persisted', { value: undefined, configurable: true });
    }
  }, apis);
}

const at = (s: string) => new Date(s);
const caption = (page: Page) => page.getByTestId('progress-caption');
const sample = readFileSync(resolve('fixtures/backups/sample.json'));

async function quickAdd(page: Page, title: string, target: 'Сегодня' | 'Завтра' = 'Сегодня') {
  const form = page.getByRole('form', { name: 'Быстрое добавление задачи' });
  await form.getByRole('radio', { name: target, exact: true }).check();
  await form.getByLabel('Новая задача').fill(title);
  await form.getByLabel('Новая задача').press('Enter');
  await expect(form.getByLabel('Новая задача')).toHaveValue('');
}

test.describe('деградация необязательных API (п. 15.3)', () => {
  test('без Web Locks и BroadcastChannel: две вкладки — автоперенос и уведомление один раз, данные обновляются при возврате во вкладку', async ({ page, context }) => {
    await disable(context, ['locks', 'broadcast']);
    await page.clock.install({ time: at('2026-10-09T20:30:00') });
    await createProfile(page);
    expect(await page.evaluate(() => [typeof navigator.locks, typeof BroadcastChannel])).toEqual(['undefined', 'undefined']);
    await quickAdd(page, 'Просроченная');
    await quickAdd(page, 'На завтра', 'Завтра');
    const second = await context.newPage();
    await second.goto('/');
    await expect(caption(second)).toHaveText('0 из 1 задачи');

    // Без BroadcastChannel изменение видно после возвращения во вкладку (focus / visibilitychange).
    await page.getByRole('checkbox', { name: 'Просроченная' }).click();
    await page.getByRole('checkbox', { name: 'Просроченная' }).click();
    await quickAdd(page, 'Из первой');
    await second.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(caption(second)).toHaveText('0 из 2 задач');

    // Уведомление: внутреннее в той вкладке, которая его показала; повторно — нигде.
    await page.clock.runFor('02:00');
    const shown = (await page.getByTestId('reminder').count()) + (await second.getByTestId('reminder').count());
    expect(shown).toBe(1);

    // Полночь в обеих вкладках: перенос ровно один раз.
    await page.clock.runFor('03:30:00');
    for (const p of [page, second]) await p.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByText('Суббота, 10.10.2026')).toBeVisible();
    await expect(second.getByText('Суббота, 10.10.2026')).toBeVisible();
    await expect(page.getByTestId('task').filter({ hasText: 'Просроченная' })).toContainText('Перенесено с 09.10');
    await openSettings(page);
    const { json } = await downloadBackup(page);
    expect((json.data as { taskMoves: unknown[] }).taskMoves).toHaveLength(2); // две задачи, по одному переносу
  });

  test('без navigator.storage.persist: работа продолжается, предупреждение на первом запуске и в настройках', async ({ page, context }) => {
    await disable(context, ['persist']);
    await page.goto('/');
    await expect(page.getByText('Данные могут быть удалены браузером')).toBeVisible();
    await createProfile(page);
    await openSettings(page);
    await expect(page.getByTestId('persistence-status')).toHaveText('Браузер может удалить данные при нехватке места или долгом перерыве');
    await expect(page.getByText('Данные могут быть удалены браузером')).toBeVisible();
  });

  test('без Web Worker: резервная копия проверяется в основном потоке и восстанавливается', async ({ page, context }) => {
    await disable(context, ['worker']);
    await createProfile(page, 'Борис');
    await openSettings(page);
    await chooseBackupFile(page, 'Восстановить из копии', { name: 'sample.json', buffer: sample });
    const dialog = page.getByRole('dialog', { name: 'Восстановить из копии?' });
    await expect(dialog.getByText('Мария')).toBeVisible();
    await dialog.getByRole('button', { name: 'Восстановить' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /, Мария$/ })).toBeVisible();
  });

  test('всё необязательное выключено сразу: основные экраны работают', async ({ page, context }) => {
    await disable(context, ['locks', 'broadcast', 'persist', 'notification', 'worker']);
    await createProfile(page);
    await quickAdd(page, 'Работает');
    await page.getByRole('checkbox', { name: 'Работает' }).click();
    await expect(caption(page)).toHaveText('Все задачи на сегодня выполнены');
    const nav = page.getByRole('navigation', { name: 'Основная навигация' });
    for (const name of ['Предстоящие', 'Привычки', 'Отчёты', 'Настройки']) {
      await nav.getByRole('link', { name }).click();
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    }
    await expect(page.getByTestId('notification-permission')).toHaveText('Этот браузер не показывает системные уведомления');
  });
});
