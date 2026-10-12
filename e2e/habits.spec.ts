import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { createProfile, expect, test } from './fixtures';

// Среда, 14 октября 2026 (неделя 12–18 октября).
const WED = new Date('2026-10-14T09:00:00');
const nav = (page: Page) => page.getByRole('navigation', { name: 'Основная навигация' });
const toasts = (page: Page) => page.locator('.toast-region');
const card = (page: Page, title: string) => page.locator('.habit-card').filter({ has: page.getByRole('button', { name: `Изменить привычку: ${title}` }) });
const circle = (page: Page, title: string, day: RegExp | string) => card(page, title).getByRole('button', { name: day });

async function openHabits(page: Page) {
  await nav(page).getByRole('link', { name: 'Привычки' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Привычки' })).toBeVisible();
}

async function addHabit(
  page: Page,
  title: string,
  type: 'Каждый день' | 'По дням недели' | 'Цель на неделю',
  fill?: (dialog: ReturnType<Page['getByRole']>) => Promise<void>,
) {
  await page.getByRole('button', { name: /^(Создать первую привычку|Новая привычка)$/ }).click();
  const d = page.getByRole('dialog', { name: 'Новая привычка' });
  await d.getByLabel('Название').fill(title);
  await d.getByRole('radio', { name: type }).check();
  if (fill) await fill(d);
  await d.getByRole('button', { name: 'Создать' }).click();
  await expect(d).toBeHidden();
  await expect(card(page, title)).toBeVisible();
}

test.describe('привычки (раздел 8)', () => {
  test('11.13: три типа; пустое состояние; без дней недели — ошибка; счётчик «0 из N»', async ({ page }) => {
    await page.clock.install({ time: WED });
    await createProfile(page);
    await openHabits(page);
    await expect(page.getByRole('heading', { name: 'Привычек пока нет' })).toBeVisible();

    await addHabit(page, 'Пить воду', 'Каждый день');
    await expect(circle(page, 'Пить воду', 'Среда, 14 октября: не выполнено')).toBeEnabled();

    await page.getByRole('button', { name: 'Новая привычка' }).click();
    const d = page.getByRole('dialog', { name: 'Новая привычка' });
    await d.getByLabel('Название').fill('Бассейн');
    await d.getByRole('radio', { name: 'По дням недели' }).check();
    await d.getByRole('button', { name: 'Создать' }).click();
    await expect(d.getByText('Выберите хотя бы один день недели')).toBeVisible();
    await expect(d.getByRole('checkbox', { name: 'понедельник' })).toBeFocused();
    await d.getByRole('checkbox', { name: 'вторник' }).check();
    await d.getByRole('checkbox', { name: 'среда' }).check();
    await d.getByRole('button', { name: 'Создать' }).click();
    await expect(d).toBeHidden();
    await expect(card(page, 'Бассейн')).toContainText('вт, ср');
    await expect(circle(page, 'Бассейн', 'Среда, 14 октября: не выполнено')).toBeVisible();
    await expect(circle(page, 'Бассейн', 'Пятница, 16 октября: не запланировано')).toBeVisible();

    await addHabit(page, 'Пробежка', 'Цель на неделю', async (dialog) => {
      await expect(dialog.getByLabel('Сколько раз в неделю (от 1 до 6)')).toHaveValue('3');
      await dialog.getByLabel('Сколько раз в неделю (от 1 до 6)').fill('2');
    });
    await expect(card(page, 'Пробежка').getByTestId('habit-counter')).toHaveText('0 из 2');
    await expect(page.locator('.habit-card .habit-title span[id]')).toHaveText(['Пить воду', 'Бассейн', 'Пробежка']);

    await page.reload({ waitUntil: 'commit' }); // WebKit в CI иногда не дожидается события load после подмены часов
    await expect(page.locator('.habit-card')).toHaveCount(3);
  });

  test('11.14: отметка и снятие; недоступные дни объясняют причину; окно — 3 дня; счётчики и блок «Сегодня»', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-05T09:00:00') }); // создаём в понедельник прошлой недели
    await createProfile(page);
    await openHabits(page);
    await addHabit(page, 'Пробежка', 'Цель на неделю', (d) => d.getByLabel('Сколько раз в неделю (от 1 до 6)').fill('2'));
    await addHabit(page, 'Бассейн', 'По дням недели', async (d) => {
      await d.getByRole('checkbox', { name: 'понедельник' }).check();
      await d.getByRole('checkbox', { name: 'среда' }).check();
    });
    await page.clock.setSystemTime(WED);
    await page.reload({ waitUntil: 'commit' }); // WebKit в CI иногда не дожидается события load после подмены часов
    await expect(page.locator('.week-range')).toHaveText('12–18 октября');

    // Сегодня — отметка ставится и снимается.
    const today = circle(page, 'Пробежка', /^Среда, 14 октября/);
    await today.click();
    await expect(today).toHaveAccessibleName('Среда, 14 октября: выполнено');
    await expect(card(page, 'Пробежка').getByTestId('habit-counter')).toHaveText('1 из 2');
    await circle(page, 'Пробежка', /^Понедельник, 12 октября/).click();
    await expect(card(page, 'Пробежка').getByTestId('habit-counter')).toHaveText('Цель недели выполнена');
    await circle(page, 'Пробежка', /^Вторник, 13 октября/).click();
    await expect(card(page, 'Пробежка').getByTestId('habit-counter')).toHaveText('3 из 2');
    await circle(page, 'Пробежка', /^Вторник, 13 октября/).click();
    await expect(card(page, 'Пробежка').getByTestId('habit-counter')).toHaveText('Цель недели выполнена');
    await today.click();
    await expect(today).toHaveAccessibleName('Среда, 14 октября: не выполнено');

    // Будущий и незапланированный дни недоступны и объясняют причину.
    const future = circle(page, 'Пробежка', /^Четверг, 15 октября/);
    await expect(future).toHaveAccessibleName('Четверг, 15 октября: недоступно');
    await future.click({ force: true });
    await expect(card(page, 'Пробежка').locator('.habit-hint')).toHaveText('Будущий день — отметить пока нельзя');
    await circle(page, 'Бассейн', /^Вторник, 13 октября/).click({ force: true });
    await expect(card(page, 'Бассейн').locator('.habit-hint')).toHaveText('В этот день привычка не запланирована');
    await expect(circle(page, 'Бассейн', /^Вторник, 13 октября/)).toHaveAccessibleName('Вторник, 13 октября: не запланировано');

    // Прошлая неделя: 11 октября (3 дня назад) — можно, 10-го и раньше — слишком старые.
    await page.getByRole('radio', { name: 'Прошлая неделя' }).check();
    await expect(page.locator('.week-range')).toHaveText('5–11 октября');
    await circle(page, 'Пробежка', /^Воскресенье, 11 октября/).click();
    await expect(circle(page, 'Пробежка', /^Воскресенье, 11 октября/)).toHaveAccessibleName('Воскресенье, 11 октября: выполнено');
    const old = circle(page, 'Пробежка', /^Суббота, 10 октября/);
    await expect(old).toHaveAccessibleName('Суббота, 10 октября: недоступно');
    await old.click({ force: true });
    await expect(card(page, 'Пробежка').locator('.habit-hint')).toHaveText('Отметить можно только за сегодня и 3 предыдущих дня');
    await expect(card(page, 'Пробежка').getByTestId('habit-counter')).toHaveText('1 из 2');

    // Блок «Привычки на сегодня»: Бассейн (среда) и Пробежка (цель не достигнута); отметка прямо здесь.
    await nav(page).getByRole('link', { name: 'Сегодня' }).click();
    const block = page.getByRole('region', { name: /^Привычки на сегодня/ });
    await expect(block.locator('.today-habit-title')).toHaveText(['Пробежка', 'Бассейн']);
    await block.locator('.today-habit').filter({ hasText: 'Бассейн' }).getByRole('button').click();
    await expect(block.locator('.today-habit').filter({ hasText: 'Бассейн' }).getByRole('button')).toHaveAccessibleName(
      'Среда, 14 октября: выполнено',
    );
    await openHabits(page);
    await expect(circle(page, 'Бассейн', /^Среда, 14 октября/)).toHaveAccessibleName('Среда, 14 октября: выполнено');
    await page.reload({ waitUntil: 'commit' }); // WebKit в CI иногда не дожидается события load после подмены часов
    await expect(circle(page, 'Бассейн', /^Среда, 14 октября/)).toHaveAccessibleName('Среда, 14 октября: выполнено');
  });

  test('11.15: смена дней пн/ср/пт → вт/чт: текущая неделя по новым дням, прошлая — по старым', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-05T09:00:00') });
    await createProfile(page);
    await openHabits(page);
    await addHabit(page, 'Бассейн', 'По дням недели', async (d) => {
      for (const day of ['понедельник', 'среда', 'пятница']) await d.getByRole('checkbox', { name: day }).check();
    });
    await page.clock.setSystemTime(WED);
    await page.reload({ waitUntil: 'commit' }); // WebKit в CI иногда не дожидается события load после подмены часов
    await page.getByRole('button', { name: 'Изменить привычку: Бассейн' }).click();
    const d = page.getByRole('dialog', { name: 'Изменить привычку' });
    await expect(d.getByText('Новое расписание действует с понедельника этой недели')).toBeVisible();
    for (const day of ['понедельник', 'среда', 'пятница']) await d.getByRole('checkbox', { name: day }).uncheck();
    for (const day of ['вторник', 'четверг']) await d.getByRole('checkbox', { name: day }).check();
    await d.getByRole('button', { name: 'Сохранить' }).click();
    await expect(d).toBeHidden();

    const states = async () =>
      card(page, 'Бассейн').locator('.habit-circle').evaluateAll((els) => els.map((e) => !e.classList.contains('habit-circle-unplanned')));
    await expect(card(page, 'Бассейн')).toContainText('вт, чт');
    expect(await states()).toEqual([false, true, false, true, false, false, false]);
    await page.getByRole('radio', { name: 'Прошлая неделя' }).check();
    expect(await states()).toEqual([true, false, true, false, true, false, false]);
  });

  test('архив: подтверждение, отмена 5 секунд, возврат из архива; ручной порядок', async ({ page }) => {
    await page.clock.install({ time: WED });
    await createProfile(page);
    await openHabits(page);
    for (const t of ['А', 'Б', 'В']) await addHabit(page, t, 'Каждый день');

    await card(page, 'В').getByRole('button', { name: 'Действия с привычкой «В»' }).click();
    await page.getByRole('button', { name: 'Выше', exact: true }).click();
    await expect(page.locator('.habit-card .habit-title span[id]')).toHaveText(['А', 'В', 'Б']);
    await expect(page.getByTestId('announcer')).toHaveText('Позиция 2 из 3');
    await expect(card(page, 'В').getByRole('button', { name: 'Действия с привычкой «В»' })).toBeFocused();
    await page.getByRole('button', { name: 'Изменить привычку: В' }).focus();
    await page.keyboard.press('Alt+ArrowUp');
    await expect(page.locator('.habit-card .habit-title span[id]')).toHaveText(['В', 'А', 'Б']);
    await expect(page.getByRole('button', { name: 'Изменить привычку: В' })).toBeFocused();

    await card(page, 'А').getByRole('button', { name: 'Действия с привычкой «А»' }).click();
    await page.getByRole('button', { name: 'Убрать в архив' }).click();
    const confirm = page.getByRole('dialog', { name: 'Убрать в архив?' });
    await expect(confirm).toContainText('останется в отчётах');
    await confirm.getByRole('button', { name: 'Убрать в архив' }).click();
    await expect(card(page, 'А')).toHaveCount(0);
    await toasts(page).locator('.toast').filter({ hasText: 'Привычка убрана в архив' }).getByRole('button', { name: 'Отменить' }).click();
    await expect(page.locator('.habit-card .habit-title span[id]')).toHaveText(['В', 'А', 'Б']);

    await card(page, 'Б').getByRole('button', { name: 'Действия с привычкой «Б»' }).click();
    await page.getByRole('button', { name: 'Убрать в архив' }).click();
    await page.getByRole('dialog', { name: 'Убрать в архив?' }).getByRole('button', { name: 'Убрать в архив' }).click();
    await expect(page.locator('.habit-card .habit-title span[id]')).toHaveText(['В', 'А']);
    await page.locator('.archive-block summary').click();
    await expect(page.locator('.archive-item')).toContainText('Б');
    await page.reload({ waitUntil: 'commit' }); // WebKit в CI иногда не дожидается события load после подмены часов
    await nav(page).getByRole('link', { name: 'Сегодня' }).click();
    await expect(page.getByRole('region', { name: /^Привычки на сегодня/ }).locator('.today-habit-title')).toHaveText(['В', 'А']);

    await page.clock.setSystemTime(new Date('2026-10-15T09:00:00'));
    await page.reload({ waitUntil: 'commit' }); // WebKit в CI иногда не дожидается события load после подмены часов
    await openHabits(page);
    await page.locator('.archive-block summary').click();
    await page.getByRole('button', { name: 'Вернуть привычку «Б»' }).click();
    await expect(toasts(page)).toContainText('Привычка возвращена');
    await expect(page.locator('.habit-card .habit-title span[id]')).toHaveText(['В', 'А', 'Б']);
    // 14-го (день архивирования) — не в плане, 15-го — снова в плане.
    await expect(circle(page, 'Б', /^Среда, 14 октября/)).toHaveAccessibleName('Среда, 14 октября: не запланировано');
    await expect(circle(page, 'Б', /^Четверг, 15 октября/)).toHaveAccessibleName('Четверг, 15 октября: не выполнено');
  });

  test('отметка только с клавиатуры', async ({ page }) => {
    await page.clock.install({ time: WED });
    await createProfile(page);
    await openHabits(page);
    await addHabit(page, 'Чтение', 'Каждый день');
    const target = circle(page, 'Чтение', /^Среда, 14 октября/);
    for (let i = 0; i < 40 && !(await target.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
    await expect(target).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(target).toHaveAccessibleName('Среда, 14 октября: выполнено');
    await expect(target).toBeFocused();
    await page.keyboard.press('Space');
    await expect(target).toHaveAccessibleName('Среда, 14 октября: не выполнено');
  });

  for (const width of [360, 768, 1280]) {
    test(`ширина ${width}: круги 32 × 32 с зазором ≥ 8 px, нет прокрутки, axe без серьёзных нарушений`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.clock.install({ time: WED });
      await createProfile(page);
      await openHabits(page);
      await addHabit(page, 'Пить воду и ещё раз пить воду, чтобы название было длинным', 'Каждый день');
      await addHabit(page, 'Бассейн', 'По дням недели', (d) => d.getByRole('checkbox', { name: 'среда' }).check());
      await addHabit(page, 'Пробежка', 'Цель на неделю');
      await circle(page, 'Бассейн', /^Среда, 14 октября/).click();
      await circle(page, 'Бассейн', /^Четверг, 15 октября/).click({ force: true });

      const boxes = await page.locator('.habit-card').first().locator('.habit-circle').evaluateAll((els) =>
        els.map((e) => e.getBoundingClientRect()).map((r) => ({ x: r.x, w: r.width, h: r.height })),
      );
      for (const b of boxes) {
        expect(b.w).toBeGreaterThanOrEqual(32);
        expect(b.h).toBeGreaterThanOrEqual(32);
      }
      for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.x - (boxes[i - 1]!.x + boxes[i - 1]!.w)).toBeGreaterThanOrEqual(8);

      const check = async (label: string) => {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${label}: горизонтальная прокрутка`).toBeLessThanOrEqual(0);
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
        const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), label).toEqual([]);
      };
      await check('экран «Привычки»');
      await page.getByRole('radio', { name: 'Прошлая неделя' }).check();
      await check('прошлая неделя');

      await card(page, 'Бассейн').getByRole('button', { name: 'Действия с привычкой «Бассейн»' }).click();
      await page.getByRole('button', { name: 'Убрать в архив' }).click();
      await check('подтверждение архива');
      await page.getByRole('dialog', { name: 'Убрать в архив?' }).getByRole('button', { name: 'Убрать в архив' }).click();
      await page.locator('.archive-block summary').click();
      await check('архив раскрыт');

      await page.getByRole('button', { name: 'Новая привычка' }).click();
      const d = page.getByRole('dialog', { name: 'Новая привычка' });
      await d.getByRole('radio', { name: 'Цель на неделю' }).check();
      await d.getByLabel('Сколько раз в неделю (от 1 до 6)').fill('9');
      await d.getByRole('button', { name: 'Создать' }).click();
      await expect(d.getByText('Введите название привычки')).toBeVisible();
      await expect(d.getByText('Цель — от 1 до 6 раз в неделю')).toBeVisible();
      await check('форма с ошибками');
      await d.getByRole('radio', { name: 'По дням недели' }).check();
      await check('форма: дни недели');
      await page.keyboard.press('Escape');
      await page.getByRole('dialog', { name: 'Закрыть без сохранения?' }).getByRole('button', { name: 'Закрыть без сохранения' }).click();

      await nav(page).getByRole('link', { name: 'Сегодня' }).click();
      await expect(page.getByRole('region', { name: /^Привычки на сегодня/ })).toBeVisible();
      await check('блок «Привычки на сегодня»');
    });
  }
});
