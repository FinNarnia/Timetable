import type { BrowserContext, Page } from '@playwright/test';
import { createProfile, expect, openSettings, test } from './fixtures';

const at = (s: string) => new Date(s);

/**
 * Подмена Notification API: разрешение задаётся тестом, показанные уведомления копятся в window.__notes.
 * hidden — вкладка «не в фокусе» (тогда к внутреннему уведомлению добавляется системное).
 */
async function stubNotifications(context: BrowserContext, permission: 'granted' | 'default' | 'denied' | 'none', hidden = false) {
  await context.addInitScript(
    ({ permission, hidden }) => {
      const w = window as unknown as { __notes: Array<{ title: string; body?: string; onclick: (() => void) | null }>; Notification?: unknown };
      w.__notes = [];
      if (permission === 'none') {
        delete w.Notification;
        return;
      }
      let current = permission;
      class FakeNotification {
        static get permission() {
          return current;
        }
        static requestPermission() {
          current = 'granted';
          return Promise.resolve(current);
        }
        onclick: (() => void) | null = null;
        constructor(
          public title: string,
          options?: { body?: string },
        ) {
          w.__notes.push(Object.assign(this, { body: options?.body }));
        }
        close() {}
      }
      w.Notification = FakeNotification;
      if (hidden) Document.prototype.hasFocus = () => false;
    },
    { permission, hidden },
  );
}

const notes = (page: Page) => page.evaluate(() => (window as unknown as { __notes: Array<{ title: string; body?: string }> }).__notes.map((n) => ({ title: n.title, body: n.body })));

async function quickAdd(page: Page, title: string, target: 'Сегодня' | 'Завтра') {
  const form = page.getByRole('form', { name: 'Быстрое добавление задачи' });
  await form.getByRole('radio', { name: target, exact: true }).check();
  await form.getByLabel('Новая задача').fill(title);
  await form.getByLabel('Новая задача').press('Enter');
  await expect(form.getByLabel('Новая задача')).toHaveValue('');
  await expect(page.locator('.toast-region')).toContainText('Задача создана');
}

test.describe('11.18 Вечернее уведомление', () => {
  test('две вкладки в 20:40: внутреннее в обеих, системное одно; «Посмотреть» — «Завтра»; после перезагрузки в 21:00 не повторяется', async ({ page, context }) => {
    await stubNotifications(context, 'granted', true);
    await page.clock.install({ time: at('2026-10-14T19:50:00') });
    await createProfile(page);
    await quickAdd(page, 'Позвонить маме', 'Завтра');
    await quickAdd(page, 'Купить хлеб', 'Завтра');
    await expect(page.getByTestId('reminder')).toHaveCount(0);
    const second = await context.newPage();
    await second.goto('/');
    await expect(second.getByRole('heading', { level: 1, name: /, Анна$/ })).toBeVisible();

    await page.clock.runFor('50:00'); // 20:40 — проверка раз в минуту в обеих вкладках
    for (const p of [page, second]) {
      const notice = p.getByTestId('reminder');
      await expect(notice).toBeVisible({ timeout: 2000 });
      await expect(notice.getByRole('heading', { name: 'На завтра 2 задачи' })).toBeVisible();
      await expect(notice.getByRole('listitem')).toHaveText(['Позвонить маме', 'Купить хлеб']);
    }
    const all = [...(await notes(page)), ...(await notes(second))];
    expect(all).toEqual([{ title: 'На завтра 2 задачи', body: 'Позвонить маме\nКупить хлеб' }]);
    // Фокус не перехвачен.
    await expect(page.getByTestId('reminder').getByRole('button', { name: 'Посмотреть' })).not.toBeFocused();

    // До полуночи на «Сегодня» есть сворачиваемый блок «Завтра».
    const block = page.getByTestId('tomorrow-block');
    await expect(block).toBeVisible();
    await block.locator('summary').click();
    await expect(block.getByTestId('task')).toHaveCount(2);

    await page.getByTestId('reminder').getByRole('button', { name: 'Посмотреть' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Предстоящие' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Завтра/ })).toBeFocused();
    await expect(page.getByTestId('reminder')).toHaveCount(0);

    await page.clock.runFor('20:00'); // 21:00
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Предстоящие' })).toBeVisible();
    await page.clock.runFor('02:00');
    await expect(page.getByTestId('reminder')).toHaveCount(0);
    expect(await notes(page)).toEqual([]);
    await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Сегодня' }).click();
    await expect(page.getByTestId('tomorrow-block')).toBeVisible();

    // После полуночи блока «Завтра» нет.
    await page.clock.runFor('03:02:00');
    await expect(page.getByTestId('tomorrow-block')).toHaveCount(0);
  });

  test('нажатие на системное уведомление открывает «Предстоящие» на группе «Завтра»', async ({ page, context }) => {
    await stubNotifications(context, 'granted', true);
    await page.clock.install({ time: at('2026-10-14T21:10:00') }); // открыли позже 20:00 — показ всё равно
    await createProfile(page);
    await quickAdd(page, 'Отправить отчёт', 'Завтра');
    await page.clock.runFor('01:00');
    await expect.poll(() => notes(page)).toEqual([{ title: 'На завтра 1 задача', body: 'Отправить отчёт' }]);
    await page.evaluate(() => (window as unknown as { __notes: Array<{ onclick: () => void }> }).__notes[0]!.onclick());
    await expect(page.getByRole('heading', { level: 1, name: 'Предстоящие' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Завтра/ })).toBeFocused();
  });

  test('нет задач на завтра или уведомление выключено — не показывается; новое время из настроек', async ({ page, context }) => {
    await stubNotifications(context, 'granted');
    await page.clock.install({ time: at('2026-10-14T19:00:00') });
    await createProfile(page);
    await page.clock.runFor('01:30:00'); // 20:30, задач на завтра нет
    await expect(page.getByTestId('reminder')).toHaveCount(0);

    await openSettings(page);
    await page.getByRole('switch', { name: 'Вечернее напоминание о задачах на завтра' }).uncheck();
    await expect(page.getByLabel('Время', { exact: true })).toBeDisabled();
    await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Сегодня' }).click();
    await quickAdd(page, 'Йога', 'Завтра');
    await page.clock.runFor('02:00');
    await expect(page.getByTestId('reminder')).toHaveCount(0);

    await openSettings(page);
    await page.getByRole('switch', { name: 'Вечернее напоминание о задачах на завтра' }).check();
    await page.getByLabel('Время', { exact: true }).selectOption('21:00');
    await page.reload();
    await expect(page.getByLabel('Время', { exact: true })).toHaveValue('21:00');
    await page.clock.runFor('10:00'); // 20:42 — рано
    await expect(page.getByTestId('reminder')).toHaveCount(0);
    await page.clock.runFor('20:00'); // 21:02
    await expect(page.getByTestId('reminder')).toBeVisible();
    // Только внутреннее: вкладка в фокусе.
    expect(await notes(page)).toEqual([]);
  });
});

test.describe('настройки уведомлений (п. 10.4, 15.3)', () => {
  test('разрешение браузера запрашивается только по кнопке; статусы', async ({ page, context }) => {
    await stubNotifications(context, 'default');
    await createProfile(page);
    await openSettings(page);
    await expect(page.getByTestId('notification-permission')).toHaveText('Не запрошены');
    await expect(page.getByText('если приложение открыто в браузере. Если оно закрыто, доставка не гарантируется', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Разрешить уведомления браузера' }).click();
    await expect(page.getByTestId('notification-permission')).toHaveText('Разрешены');
    await expect(page.getByRole('button', { name: 'Разрешить уведомления браузера' })).toHaveCount(0);
    await expect(page.getByLabel('Время', { exact: true })).toHaveValue('20:00');
    await expect(page.getByLabel('Время', { exact: true }).locator('option')).toHaveCount(12);
  });

  test('заблокированы — статус и подсказка, без кнопки', async ({ page, context }) => {
    await stubNotifications(context, 'denied');
    await createProfile(page);
    await openSettings(page);
    await expect(page.getByTestId('notification-permission')).toHaveText('Заблокированы в настройках браузера');
    await expect(page.getByRole('button', { name: 'Разрешить уведомления браузера' })).toHaveCount(0);
  });

  test('без Notification API — только внутреннее уведомление, кнопка скрыта', async ({ page, context }) => {
    await stubNotifications(context, 'none');
    await page.clock.install({ time: at('2026-10-14T19:59:00') });
    await createProfile(page);
    await quickAdd(page, 'Йога', 'Завтра');
    await openSettings(page);
    await expect(page.getByTestId('notification-permission')).toHaveText('Этот браузер не показывает системные уведомления');
    await expect(page.getByRole('button', { name: 'Разрешить уведомления браузера' })).toHaveCount(0);
    await page.clock.runFor('02:00');
    await expect(page.getByTestId('reminder')).toBeVisible();
  });
});
