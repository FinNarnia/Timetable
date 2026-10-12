import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { generateNKeysBetween } from 'fractional-indexing';
import { chooseBackupFile, createProfile, downloadBackup, expect, openSettings, perfLimit, test } from './fixtures';

// Пятница, 9 октября 2026. Часы задаются в часовом поясе процесса, он же — пояс браузера (playwright.config.ts).
const at = (s: string) => new Date(s);
const DAY1 = '2026-10-09T09:00:00';

const nav = (page: Page) => page.getByRole('navigation', { name: 'Основная навигация' });
const toasts = (page: Page) => page.locator('.toast-region');
const caption = (page: Page) => page.getByTestId('progress-caption');

function group(page: Page, name: string) {
  return page.getByRole('region', { name: new RegExp(`^${name}( \\d+)?$`) });
}
function titles(scope: ReturnType<Page['locator']>) {
  return scope.getByTestId('task').locator('.task-title span[id]');
}
async function openUpcoming(page: Page) {
  await nav(page).getByRole('link', { name: 'Предстоящие' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Предстоящие' })).toBeVisible();
}
async function openToday(page: Page) {
  await nav(page).getByRole('link', { name: 'Сегодня' }).click();
  await expect(caption(page)).toBeVisible();
}
async function quickAdd(page: Page, title: string, target: 'Сегодня' | 'Завтра' | 'Без даты' = 'Сегодня') {
  const form = page.getByRole('form', { name: 'Быстрое добавление задачи' });
  await form.getByRole('radio', { name: target, exact: true }).check();
  await form.getByLabel('Новая задача').fill(title);
  await form.getByLabel('Новая задача').press('Enter');
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
}

/** Новая повторяющаяся задача через расширенную форму. */
async function addSeries(page: Page, title: string, frequency: 'Каждый день' | 'По дням недели' | 'Каждый месяц', time?: string) {
  await openToday(page);
  await page.getByRole('button', { name: 'Подробнее…' }).click();
  const d = page.getByRole('dialog', { name: 'Новая задача' });
  await d.getByLabel('Название', { exact: true }).fill(title);
  await d.getByRole('radio', { name: time ? 'Дата и время' : 'Дата', exact: true }).check();
  if (time) await d.getByLabel('Время', { exact: true }).fill(time);
  await d.getByLabel('Повторение').selectOption({ label: frequency });
  await d.getByRole('button', { name: 'Сохранить' }).click();
  await expect(d).toBeHidden();
}

async function choose(page: Page, option: 'Только эту задачу' | 'Всю серию') {
  const dialog = page.getByRole('dialog', { name: /повторяющуюся задачу$/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: option }).click();
  await expect(dialog).toBeHidden();
}

test.describe('повторяющиеся задачи (п. 6.6)', () => {
  test('11.3: ошибки повторения у полей — пустые дни недели, дата окончания раньше первой даты', async ({ page }) => {
    await page.clock.install({ time: at(DAY1) });
    await createProfile(page);
    await page.getByRole('button', { name: 'Подробнее…' }).click();
    const d = page.getByRole('dialog', { name: 'Новая задача' });
    await d.getByLabel('Название', { exact: true }).fill('Бассейн');
    await d.getByRole('radio', { name: 'Дата', exact: true }).check();
    await d.getByLabel('Повторение').selectOption({ label: 'По дням недели' });
    await expect(d.getByRole('checkbox', { name: 'пятница' })).toBeChecked(); // по умолчанию — день первой даты
    await d.getByRole('checkbox', { name: 'пятница' }).uncheck();
    await d.getByLabel('Дата окончания (необязательно)').fill('2026-10-01');
    await d.getByRole('button', { name: 'Сохранить' }).click();
    await expect(d.getByText('Выберите хотя бы один день недели')).toBeVisible();
    await expect(d.getByText('Дата окончания — не раньше первой даты')).toBeVisible();
    await expect(d.getByRole('checkbox', { name: 'понедельник' })).toBeFocused();
    await d.getByRole('checkbox', { name: 'понедельник' }).check();
    await d.getByRole('checkbox', { name: 'среда' }).check();
    await d.getByLabel('Дата окончания (необязательно)').fill('2026-10-31');
    await d.getByRole('button', { name: 'Сохранить' }).click();
    await expect(d).toBeHidden();
    await openUpcoming(page);
    await expect(page.locator('.task-group .group-title')).toHaveText([/^пн, 12 окт/, /^ср, 14 окт/, /^пн, 19 окт/, /^ср, 21 окт/]);
    await expect(page.getByText('Повторяющиеся задачи показаны на 2 недели вперёд')).toBeVisible();
    await expect(page.getByTestId('task').first().locator('.meta-repeat')).toContainText('Повторяющаяся задача');
  });

  test('11.5: «Только эту задачу» и «Всю серию»; исключения и выполненный сегодняшний не меняются', async ({ page }) => {
    await page.clock.install({ time: at(DAY1) });
    await createProfile(page);
    await addSeries(page, 'Зарядка', 'Каждый день', '07:30');
    await expect(titles(group(page, 'Выполнено сегодня').or(group(page, 'Сегодня')))).toContainText(['Зарядка']);
    await page.getByRole('checkbox', { name: 'Зарядка' }).click();
    await expect(caption(page)).toHaveText('Все задачи на сегодня выполнены');

    // Только эту: завтрашняя становится исключением.
    await openUpcoming(page);
    await expect(page.locator('.task-group')).toHaveCount(13);
    await group(page, 'Завтра').getByRole('button', { name: 'Изменить задачу: Зарядка' }).click();
    let form = page.getByRole('dialog', { name: 'Изменить задачу' });
    await expect(form.getByLabel('Повторение')).toHaveValue('daily');
    await form.getByLabel('Название', { exact: true }).fill('Зарядка в парке');
    await form.getByRole('button', { name: 'Сохранить' }).click();
    await choose(page, 'Только эту задачу');
    await expect(toasts(page)).toContainText('Изменения сохранены');
    await expect(titles(group(page, 'Завтра'))).toHaveText(['Зарядка в парке']);
    await expect(titles(group(page, 'пн, 12 окт'))).toHaveText(['Зарядка']);

    // Всю серию: меняем время с понедельника — все будущие, кроме исключения.
    await group(page, 'пн, 12 окт').getByRole('button', { name: 'Изменить задачу: Зарядка' }).click();
    form = page.getByRole('dialog', { name: 'Изменить задачу' });
    await form.getByLabel('Название', { exact: true }).fill('Утренняя зарядка');
    await form.getByLabel('Время', { exact: true }).fill('08:00');
    await form.getByRole('button', { name: 'Сохранить' }).click();
    await choose(page, 'Всю серию');
    await expect(titles(group(page, 'Завтра'))).toHaveText(['Зарядка в парке']);
    await expect(group(page, 'Завтра').getByTestId('task')).toContainText('07:30');
    await expect(titles(group(page, 'вс, 11 окт'))).toHaveText(['Утренняя зарядка']);
    await expect(group(page, 'вс, 11 окт').getByTestId('task')).toContainText('08:00');
    await openToday(page);
    await expect(titles(group(page, 'Выполнено сегодня'))).toHaveText(['Зарядка']);
    await expect(caption(page)).toHaveText('Все задачи на сегодня выполнены');

    // Смена правила — только для всей серии; смена даты — только для этой задачи.
    await openUpcoming(page);
    await group(page, 'вс, 11 окт').getByRole('button', { name: 'Изменить задачу: Утренняя зарядка' }).click();
    form = page.getByRole('dialog', { name: 'Изменить задачу' });
    await form.getByLabel('Повторение').selectOption({ label: 'По дням недели' });
    await form.getByRole('button', { name: 'Сохранить' }).click();
    const choice = page.getByRole('dialog', { name: 'Изменить повторяющуюся задачу' });
    await expect(choice.getByRole('button', { name: 'Только эту задачу' })).toBeDisabled();
    await expect(choice.getByText('Правило повторения меняется только для всей серии.')).toBeVisible();
    await choice.getByRole('button', { name: 'Всю серию' }).click();
    // По дням недели, по умолчанию — день первой даты (пятница).
    await expect(page.locator('.task-group .group-title')).toHaveText([/^Завтра/, /^пт, 16 окт/]);
    await page.reload();
    await expect(page.locator('.task-group .group-title')).toHaveText([/^Завтра/, /^пт, 16 окт/]);
  });

  test('удаление экземпляра: «Только эту задачу» и «Всю серию» с отменой', async ({ page }) => {
    await page.clock.install({ time: at(DAY1) });
    await createProfile(page);
    await addSeries(page, 'Витамины', 'Каждый день');
    await openUpcoming(page);
    await expect(page.locator('.task-group')).toHaveCount(13);

    await group(page, 'Завтра').getByRole('button', { name: 'Действия с задачей «Витамины»' }).click();
    await page.getByRole('button', { name: 'Удалить', exact: true }).click();
    await choose(page, 'Только эту задачу');
    await expect(group(page, 'Завтра')).toHaveCount(0);
    await expect(page.locator('.task-group')).toHaveCount(12);

    await page.getByRole('button', { name: 'Действия с задачей «Витамины»' }).first().click();
    await page.getByRole('button', { name: 'Удалить', exact: true }).click();
    await choose(page, 'Всю серию');
    await expect(toasts(page)).toContainText('Серия удалена');
    await expect(page.getByRole('heading', { name: 'Здесь появятся задачи на будущие дни' })).toBeVisible();
    await openToday(page);
    await expect(caption(page)).toHaveText('Нет задач на сегодня');
    await toasts(page).locator('.toast').filter({ hasText: 'Серия удалена' }).getByRole('button', { name: 'Отменить' }).click();
    await expect(caption(page)).toHaveText('0 из 1 задачи');
    await openUpcoming(page);
    await expect(page.locator('.task-group')).toHaveCount(12);
  });

  test('включение повторения у обычной задачи', async ({ page }) => {
    await page.clock.install({ time: at(DAY1) });
    await createProfile(page);
    await quickAdd(page, 'Полить цветы');
    await page.getByRole('button', { name: 'Изменить задачу: Полить цветы' }).click();
    const form = page.getByRole('dialog', { name: 'Изменить задачу' });
    await form.getByLabel('Повторение').selectOption({ label: 'Каждый месяц' });
    await expect(form.getByText('Каждый месяц 9 числа.')).toBeVisible();
    await form.getByRole('button', { name: 'Сохранить' }).click();
    await expect(form).toBeHidden();
    await expect(group(page, 'Сегодня').getByTestId('task').locator('.meta-repeat')).toHaveCount(1);
    await expect(caption(page)).toHaveText('0 из 1 задачи');
  });
});

test.describe('обслуживание дня (п. 10.2)', () => {
  test('11.8: автоперенос с меткой, вчерашний экземпляр не показан, повторное открытие ничего не меняет', async ({ page }) => {
    await page.clock.install({ time: at(DAY1) });
    await createProfile(page);
    await quickAdd(page, 'Новая задача Б');
    await quickAdd(page, 'Задача А');
    await addSeries(page, 'Серия Б', 'Каждый день');
    await expect(caption(page)).toHaveText('0 из 3 задач');

    await page.clock.setSystemTime(at('2026-10-10T09:00:00'));
    await page.reload();
    await expect(page.getByText('Суббота, 10.10.2026')).toBeVisible();
    const today = group(page, 'Сегодня');
    // Перенесённые без времени — в начале группы, сохраняя взаимный порядок; сегодняшний экземпляр серии — после них.
    await expect(titles(today)).toHaveText(['Новая задача Б', 'Задача А', 'Серия Б']);
    await expect(today.getByTestId('task').filter({ hasText: 'Задача А' })).toContainText('Перенесено с 09.10');
    await expect(today.getByTestId('task').filter({ hasText: 'Серия Б' })).not.toContainText('Перенесено');
    await expect(caption(page)).toHaveText('0 из 3 задач');

    await page.reload();
    await expect(titles(group(page, 'Сегодня'))).toHaveText(['Новая задача Б', 'Задача А', 'Серия Б']);
    await openSettings(page);
    const { json } = await downloadBackup(page);
    const data = json.data as { taskMoves: unknown[]; tasks: Array<{ status: string; title: string }> };
    expect(data.taskMoves).toHaveLength(2);
    expect(data.tasks.filter((t) => t.status === 'missed').map((t) => t.title)).toEqual(['Серия Б']);
  });

  test('«Переносится N-й раз» на третий день', async ({ page }) => {
    await page.clock.install({ time: at(DAY1) });
    await createProfile(page);
    await quickAdd(page, 'Разобрать почту');
    for (const day of ['10', '11', '12']) {
      await page.clock.setSystemTime(at(`2026-10-${day}T09:00:00`));
      await page.reload();
      await expect(caption(page)).toHaveText('0 из 1 задачи');
    }
    await expect(page.getByTestId('task')).toContainText('Переносится 3-й раз');
  });

  test('11.9: смена дня при открытом приложении — новая дата, выполненные исчезают, невыполненные переносятся, форма не закрывается', async ({ page }) => {
    await page.clock.install({ time: at('2026-10-09T23:58:00') });
    await createProfile(page);
    await quickAdd(page, 'Сделано вчера');
    await quickAdd(page, 'Не успела');
    await page.getByRole('checkbox', { name: 'Сделано вчера' }).click();
    await expect(titles(group(page, 'Выполнено сегодня'))).toHaveText(['Сделано вчера']);
    await quickAdd(page, 'Черновик', 'Без даты');
    await page.getByRole('button', { name: 'Изменить задачу: Черновик' }).click();
    const form = page.getByRole('dialog', { name: 'Изменить задачу' });
    await form.getByLabel('Заметка').fill('пишу в полночь');

    await page.clock.runFor('03:00');
    await expect(page.getByText('Суббота, 10.10.2026')).toBeVisible();
    await expect(form).toBeVisible();
    await expect(form.getByLabel('Заметка')).toHaveValue('пишу в полночь');
    await form.getByRole('button', { name: 'Сохранить' }).click();
    await expect(form).toBeHidden();
    await expect(group(page, 'Выполнено сегодня')).toHaveCount(0);
    await expect(titles(group(page, 'Сегодня'))).toHaveText(['Не успела']);
    await expect(group(page, 'Сегодня').getByTestId('task')).toContainText('Перенесено с 09.10');
    await expect(caption(page)).toHaveText('0 из 1 задачи');
  });

  // Порог п. 15.2 — 300 мс в эталонном окружении (настольный компьютер без замедления). В контейнере CI запись
  // в IndexedDB в 2–3 раза медленнее, поэтому здесь — замер и защита от регрессии; порог сверяется в шаге 7.
  test.describe('в обычном профиле браузера', () => {
    test.use({ realProfile: true });

    test('производительность @perf: 500 активных задач и 50 серий — обслуживание дня ≤ 300 мс (п. 15.2)', async ({ page, browserName }) => {
      test.skip(browserName !== 'chromium', 'замеры — в Chromium');
      // Без подмены часов: подменённые часы Playwright отключают performance.measure. Даты — от настоящего «сегодня».
      const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const real = new Date();
      const YESTERDAY = iso(new Date(real.getFullYear(), real.getMonth(), real.getDate() - 1));
      const GENERATED = iso(new Date(real.getFullYear(), real.getMonth(), real.getDate() + 12));
      const sample = JSON.parse(readFileSync(resolve('fixtures/backups/sample.json'), 'utf8'));
      const d = sample.data;
      const userId = d.profile.id;
      const now = new Date(real.getTime() - 86_400_000).toISOString();
      const base = () => ({ id: randomUUID(), userId, rev: 1, createdAt: now, updatedAt: now, deletedAt: null });
      const calendarId = d.calendars[0].id;
      const keys = generateNKeysBetween(null, null, 1200);
      const series = Array.from({ length: 50 }, (_, i) => ({
        ...base(),
        calendarId,
        title: `Серия ${i}`,
        note: '',
        priority: 'normal',
        categoryId: null,
        scheduleType: 'date',
        plannedTime: null,
        rule: { frequency: 'daily', interval: 1, weekdays: [], monthDay: null },
        startDate: YESTERDAY,
        untilDate: null,
        generatedUntil: GENERATED,
      }));
      const task = (title: string, date: string, extra: object = {}) => ({
        ...base(),
        calendarId,
        title,
        note: '',
        status: 'active',
        priority: 'normal',
        categoryId: null,
        scheduleType: 'date',
        plannedDate: date,
        plannedTime: null,
        seriesId: null,
        occurrenceDate: null,
        isException: false,
        sortOrder: keys.pop(),
        autoMoveCount: 0,
        completedAt: null,
        ...extra,
      });
      const tasks = [
        ...Array.from({ length: 500 }, (_, i) => task(`Задача ${i}`, YESTERDAY)),
        ...series.map((s) => task(s.title, YESTERDAY, { seriesId: s.id, occurrenceDate: YESTERDAY })),
      ];
      const backup = {
        ...sample,
        data: { ...d, tasks, taskSeries: series, taskMoves: [], habits: [], habitSchedules: [], habitChecks: [], settings: { ...d.settings, lastMaintenanceDate: YESTERDAY } },
      };
      await createProfile(page);
      // Бенчмарк: три восстановления фикстуры, после каждого — обслуживание дня; сравниваем медиану с порогом.
      for (let run = 0; run < 3; run++) {
        await openSettings(page);
        await chooseBackupFile(page, 'Восстановить из копии', { name: 'maintenance.json', buffer: Buffer.from(JSON.stringify(backup)) });
        await page.getByRole('dialog', { name: 'Восстановить из копии?' }).getByRole('button', { name: 'Восстановить' }).click();
        await expect(page.locator('.toast-region')).toContainText('Данные восстановлены из резервной копии');
        // Сразу после восстановления выполняется обслуживание дня: 500 переносов, 50 пропусков, экземпляры на 14-й день.
        await openToday(page);
        await expect(caption(page)).toHaveText('0 из 500 задач', { timeout: 15_000 });
      }
      const durations = await page.evaluate(() => performance.getEntriesByName('moy-ritm:maintenance').map((e) => e.duration));
      const runs = durations.slice(-3);
      const median = [...runs].sort((a, b) => a - b)[1]!;
      console.log(`Обслуживание дня (500 задач, 50 серий), мс: ${runs.map((x) => x.toFixed(0)).join(', ')}; медиана ${median.toFixed(0)}`);
      expect(runs).toHaveLength(3);
      expect(median).toBeLessThanOrEqual(perfLimit(300, 1000));
    });
  });
});

test.describe('несколько вкладок (п. 10.3)', () => {
  test('изменения видны во второй вкладке; перенос при смене дня выполняется один раз', async ({ page, context }) => {
    await page.clock.install({ time: at('2026-10-09T23:59:00') });
    await createProfile(page);
    const second = await context.newPage();
    await second.goto('/');
    await expect(caption(second)).toHaveText('Нет задач на сегодня');

    await quickAdd(page, 'Из первой вкладки');
    await expect(titles(group(second, 'Сегодня'))).toHaveText(['Из первой вкладки'], { timeout: 1500 });
    await expect(caption(second)).toHaveText('0 из 1 задачи');

    await second.getByRole('checkbox', { name: 'Из первой вкладки' }).click();
    await expect(caption(page)).toHaveText('Все задачи на сегодня выполнены', { timeout: 1500 });
    await second.getByRole('checkbox', { name: 'Из первой вкладки' }).click();
    await expect(caption(page)).toHaveText('0 из 1 задачи', { timeout: 1500 });

    // Полночь в обеих вкладках.
    await page.clock.runFor('02:00');
    await expect(page.getByText('Суббота, 10.10.2026')).toBeVisible();
    await expect(second.getByText('Суббота, 10.10.2026')).toBeVisible();
    await expect(page.getByTestId('task')).toContainText('Перенесено с 09.10');
    await expect(second.getByTestId('task')).toContainText('Перенесено с 09.10');
    await openSettings(page);
    const { json } = await downloadBackup(page);
    expect((json.data as { taskMoves: unknown[] }).taskMoves).toHaveLength(1);
  });

  test('конфликт правок: «Загрузить новую версию» и «Сохранить мои изменения»', async ({ page, context }) => {
    await createProfile(page);
    await quickAdd(page, 'Общая задача');
    const second = await context.newPage();
    await second.goto('/');

    await page.getByRole('button', { name: 'Изменить задачу: Общая задача' }).click();
    const form = page.getByRole('dialog', { name: 'Изменить задачу' });
    await form.getByLabel('Название', { exact: true }).fill('Моя версия');

    await second.getByRole('button', { name: 'Изменить задачу: Общая задача' }).click();
    const other = second.getByRole('dialog', { name: 'Изменить задачу' });
    await other.getByLabel('Название', { exact: true }).fill('Версия второй вкладки');
    await other.getByRole('button', { name: 'Сохранить' }).click();
    await expect(other).toBeHidden();

    await form.getByRole('button', { name: 'Сохранить' }).click();
    const warning = page.getByRole('dialog', { name: 'Задачу изменили в другой вкладке' });
    await expect(warning).toBeVisible();
    await warning.getByRole('button', { name: 'Загрузить новую версию' }).click();
    const reloaded = page.getByRole('dialog', { name: 'Изменить задачу' });
    await expect(reloaded.getByLabel('Название', { exact: true })).toHaveValue('Версия второй вкладки');

    // Ещё раз: теперь сохраняем свою версию поверх.
    await reloaded.getByLabel('Название', { exact: true }).fill('Моя версия');
    await second.getByRole('button', { name: 'Изменить задачу: Версия второй вкладки' }).click();
    await other.getByLabel('Название', { exact: true }).fill('Снова вторая');
    await other.getByRole('button', { name: 'Сохранить' }).click();
    await expect(other).toBeHidden();
    await reloaded.getByRole('button', { name: 'Сохранить' }).click();
    await page.getByRole('dialog', { name: 'Задачу изменили в другой вкладке' }).getByRole('button', { name: 'Сохранить мои изменения' }).click();
    await expect(page.getByRole('dialog', { name: 'Изменить задачу' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Изменить задачу: Моя версия' })).toBeVisible();
    await expect(second.getByRole('button', { name: 'Изменить задачу: Моя версия' })).toBeVisible({ timeout: 1500 });
  });
});
