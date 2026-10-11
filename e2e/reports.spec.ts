import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { generateNKeysBetween } from 'fractional-indexing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chooseBackupFile, createProfile, expect, openSettings, perfLimit, seedReportCase, test } from './fixtures';

test.describe('11.16 Отчёты', () => {
  test('текущая неделя «по состоянию на сегодня», предыдущая неделя, месяц с сеткой и прогрессом привычек, предыдущий месяц', async ({ page }) => {
    await seedReportCase(page, 'R18'); // сегодня — ср, 14 окт 2026
    await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Отчёты' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Отчёты' })).toBeVisible();

    // Текущая неделя.
    await expect(page.getByRole('radio', { name: 'Неделя' })).toBeChecked();
    await expect(page.getByRole('heading', { level: 2, name: 'пн, 12 окт — вс, 18 окт 2026' })).toBeVisible();
    await expect(page.getByText('По состоянию на сегодня')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Позже →' })).toBeDisabled();
    const tasks = page.getByTestId('summary-tasks');
    const habits = page.getByTestId('summary-habits');
    await expect(tasks.locator('.stat-percent')).toHaveText('67%'); // 4 из 6
    await expect(tasks.getByRole('definition').first()).toHaveText('4 из 6');
    await expect(habits.locator('.stat-percent')).toHaveText('33%'); // «Вода» 1 из 3, «Пробежка» — неделя идёт
    // Таблица для скринридера: те же данные, что в столбцах.
    const table = page.getByRole('table', { name: /По дням/ });
    await expect(table.getByRole('row', { name: /Вторник, 13 октября/ })).toContainText('2 из 3');
    await expect(table.getByRole('row', { name: /Четверг, 15 октября/ })).toContainText('Впереди');
    const runningRow = page.getByTestId('report-habit').filter({ hasText: 'Пробежка' });
    await expect(runningRow).toContainText('0 из 2, неделя идёт');
    await expect(runningRow.getByText('Среда, 14 октября: без отметки')).toBeAttached();

    // Предыдущая неделя.
    await page.getByRole('button', { name: '← Раньше' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'пн, 5 окт — вс, 11 окт 2026' })).toBeVisible();
    await expect(page.getByText('По состоянию на сегодня')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Позже →' })).toBeEnabled();
    await expect(tasks.locator('.stat-percent')).toHaveText('29%'); // 4 из 14
    await expect(habits.locator('.stat-percent')).toHaveText('56%'); // 4 из 7 + 1 из 2
    await expect(page.getByTestId('report-habit').filter({ hasText: 'Вода' })).toContainText('4 из 7');

    // Месяц.
    await page.getByRole('radio', { name: 'Месяц' }).check();
    await expect(page.getByRole('heading', { level: 2, name: 'Октябрь 2026' })).toBeVisible();
    await expect(page.getByText('По состоянию на сегодня')).toBeVisible();
    await expect(tasks.locator('.stat-percent')).toHaveText('40%');
    await expect(habits.locator('.stat-percent')).toHaveText('50%');
    const grid = page.getByRole('group', { name: 'Активность, Октябрь 2026' });
    await expect(grid.getByRole('button')).toHaveCount(31);
    const cell = grid.getByRole('button', { name: '6 октября: 2 из 5, 40%' });
    await expect(cell).toHaveClass(/cell-l2/);
    await cell.click();
    await expect(page.getByText('6 октября: 2 из 5, 40% (задачи 1 из 4, привычки 1 из 1)')).toBeVisible();
    await expect(grid.getByRole('button', { name: '1 октября: нет плана' })).toBeVisible();
    await expect(grid.getByRole('button', { name: '20 октября: впереди' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Уровни' }).getByRole('listitem')).toHaveText(['нет плана', '0–24%', '25–49%', '50–74%', '75–100%', 'впереди']);
    const water = page.getByTestId('report-habit').filter({ hasText: 'Вода' });
    await expect(water).toContainText('5 из 10');
    await expect(water).toContainText('50%');
    await expect(page.getByTestId('report-habit').filter({ hasText: 'Пробежка' })).toContainText('Текущая неделя: 0 из 2, неделя идёт');

    // Предыдущий месяц: данных нет, «Раньше» недоступна (профиль создан 1 сентября).
    await page.getByRole('button', { name: '← Раньше' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Сентябрь 2026' })).toBeVisible();
    await expect(tasks.getByText('Нет запланированных')).toBeVisible();
    await expect(page.getByRole('button', { name: '← Раньше' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Позже →' })).toBeEnabled();

    // Обратно к неделе — снова текущая.
    await page.getByRole('radio', { name: 'Неделя' }).check();
    await expect(page.getByRole('heading', { level: 2, name: 'пн, 12 окт — вс, 18 окт 2026' })).toBeVisible();
  });

  test('отметка привычки на другом экране сразу видна в отчёте', async ({ page }) => {
    await seedReportCase(page, 'R14'); // «Пробежка» 2 из 3 на текущей неделе
    const nav = page.getByRole('navigation', { name: 'Основная навигация' });
    await nav.getByRole('link', { name: 'Отчёты' }).click();
    const run = page.getByTestId('report-habit').filter({ hasText: 'Пробежка' });
    await expect(run).toContainText('2 из 3, неделя идёт');
    await nav.getByRole('link', { name: 'Привычки' }).click();
    await page.locator('[data-habit-id]').filter({ hasText: 'Пробежка' }).getByRole('button', { name: 'Среда, 14 октября: не выполнено' }).click();
    await nav.getByRole('link', { name: 'Отчёты' }).click();
    await expect(run).toContainText('3 из 3');
    await expect(page.getByTestId('summary-habits').locator('.stat-percent')).toHaveText('100%');
    await expect(page.getByTestId('summary-habits').getByRole('definition').first()).toHaveText('6 из 6');
  });
});

/**
 * Фикстура п. 15.2: 10 000 задач и 20 000 отметок в одном (прошлом) месяце — худший случай для расчёта отчёта:
 * все данные попадают в период. Даты — от настоящего «сегодня» (подменённые часы отключают performance.measure).
 * Для замера данные пишутся прямо в базу (как накопленные обычной работой); отдельный тест восстанавливает их из копии (~11 МБ, лимит 25 МБ).
 */
function denseData(userId: string, calendarId: string) {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const real = new Date();
  const first = new Date(real.getFullYear(), real.getMonth() - 1, 1);
  const days = new Date(real.getFullYear(), real.getMonth(), 0).getDate();
  const monthDays = Array.from({ length: days }, (_, i) => iso(new Date(first.getFullYear(), first.getMonth(), i + 1)));
  // Окно отметок месяца: от понедельника недели с первым четвергом до воскресенья недели с последним четвергом.
  const windowDays = Array.from({ length: days + 12 }, (_, i) => iso(new Date(first.getFullYear(), first.getMonth(), i - 6)));
  const created = new Date(first.getFullYear(), first.getMonth() - 2, 1).toISOString();
  const base = () => ({ id: randomUUID(), userId, rev: 1, createdAt: created, updatedAt: created, deletedAt: null as string | null });
  // Пара seriesId + occurrenceDate уникальна: своя серия на каждый «оборот» по дням месяца.
  const taskSeries = Array.from({ length: Math.ceil(10_000 / days) }, (_, n) => ({ ...base(), calendarId, title: `Серия ${n}`, note: '', priority: 'normal',
    categoryId: null, scheduleType: 'date', plannedTime: null, rule: { frequency: 'daily', interval: 1, weekdays: [], monthDay: null },
    startDate: monthDays[0], untilDate: monthDays[days - 1], generatedUntil: monthDays[days - 1] }));
  const keys = generateNKeysBetween(null, null, 10_000);
  const tasks = [];
  const taskMoves = [];
  for (let i = 0; i < 10_000; i++) {
    const date = monthDays[i % days]!;
    const kind = i % 10; // 0–5 выполнены, 6–7 пропущенные экземпляры, 8 — выполнена после автопереноса, 9 — без даты
    const done = kind <= 5 || kind === 8 || kind === 9;
    const t = { ...base(), calendarId, title: `Задача ${i}`, note: '', status: kind === 6 || kind === 7 ? 'missed' : 'completed', priority: 'normal',
      categoryId: null, scheduleType: kind === 9 ? 'none' : 'date', plannedDate: kind === 9 ? null : date, plannedTime: null,
      seriesId: kind === 6 || kind === 7 ? taskSeries[Math.floor(i / days)]!.id : null, occurrenceDate: null as string | null, isException: false, sortOrder: keys[i]!,
      autoMoveCount: kind === 8 ? 1 : 0, completedAt: done ? new Date(`${date}T10:00:00`).toISOString() : null };
    if (t.seriesId) t.occurrenceDate = date;
    if (i % 50 === 0) t.deletedAt = real.toISOString(); // удалены сегодня — в прошлом месяце остаются
    tasks.push(t);
    if (kind === 8) taskMoves.push({ ...base(), taskId: t.id, fromDate: monthDays[(i + days - 1) % days]!, toDate: date, reason: 'auto' });
  }
  const habitCount = Math.ceil(20_000 / windowDays.length);
  const habitKeys = generateNKeysBetween(null, null, habitCount);
  const habits = [];
  const habitSchedules = [];
  const habitChecks = [];
  for (let h = 0; h < habitCount; h++) {
    const habit = { ...base(), title: `Привычка ${h}`, sortOrder: habitKeys[h]!, archivedAt: null };
    habits.push(habit);
    const type = ['daily', 'weekdays', 'weekly_target'][h % 3];
    habitSchedules.push({ ...base(), habitId: habit.id, effectiveFrom: iso(new Date(first.getFullYear(), first.getMonth() - 1, 1)), active: true, type,
      weekdays: type === 'weekdays' ? [1, 3, 5] : [], weeklyTarget: type === 'weekly_target' ? 3 : null });
    for (const date of windowDays) if (habitChecks.length < 20_000) habitChecks.push({ ...base(), habitId: habit.id, date });
  }
  return { created, stores: { tasks, taskSeries, taskMoves, habits, habitSchedules, habitChecks } };
}

/** Восстанавливает фикстуру из резервной копии через настройки; возвращает время восстановления, мс. */
async function restoreDense(page: Page): Promise<number> {
  const sample = JSON.parse(readFileSync(resolve('fixtures/backups/sample.json'), 'utf8'));
  const d = sample.data;
  const { created, stores } = denseData(d.profile.id, d.calendars[0].id);
  const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  const backup = Buffer.from(
    JSON.stringify({
      ...sample,
      data: { ...d, profile: { ...d.profile, createdAt: created }, settings: { ...d.settings, lastMaintenanceDate: iso(new Date()) }, categories: [], ...stores },
    }),
  );
  expect(backup.length, 'копия объёма п. 15.2 больше прежнего лимита 10 МБ').toBeGreaterThan(10 * 1024 * 1024);
  expect(backup.length).toBeLessThan(25 * 1024 * 1024);
  await openSettings(page);
  await chooseBackupFile(page, 'Восстановить из копии', { name: 'reports-perf.json', buffer: backup });
  const restore = page.getByRole('dialog', { name: 'Восстановить из копии?' }).getByRole('button', { name: 'Восстановить' });
  await restore.waitFor({ timeout: 60_000 });
  const started = Date.now();
  await restore.click();
  await expect(page.locator('.toast-region')).toContainText('Данные восстановлены из резервной копии', { timeout: 60_000 });
  return Date.now() - started;
}

/** Пишет записи прямо в базу приложения (после создания профиля) и перезагружает страницу. */
async function seedDense(page: Page) {
  const ids = await page.evaluate(
    () =>
      new Promise<{ userId: string; calendarId: string }>((resolveIds, reject) => {
        const open = indexedDB.open('moy-ritm');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction(['profile', 'calendars'], 'readonly');
          const p = tx.objectStore('profile').getAll();
          const c = tx.objectStore('calendars').getAll();
          tx.oncomplete = () => {
            open.result.close();
            resolveIds({ userId: p.result[0].id, calendarId: c.result[0].id });
          };
        };
      }),
  );
  const { created, stores } = denseData(ids.userId, ids.calendarId);
  await page.evaluate(
    ({ created, stores }) =>
      new Promise<void>((done, reject) => {
        const open = indexedDB.open('moy-ritm');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction([...Object.keys(stores), 'profile'], 'readwrite');
          for (const [name, rows] of Object.entries(stores)) for (const row of rows as object[]) tx.objectStore(name).put(row);
          const profiles = tx.objectStore('profile');
          const get = profiles.getAll();
          get.onsuccess = () => profiles.put({ ...get.result[0], createdAt: created });
          tx.oncomplete = () => {
            db.close();
            done();
          };
          tx.onabort = () => reject(new Error(`IndexedDB: ${tx.error?.name} ${tx.error?.message}`));
        };
      }),
    { created, stores },
  );
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

async function measureReports(page: Page, label: string, limit: number) {
  await page.evaluate(() => performance.clearMeasures('moy-ritm:report'));
  const nav = page.getByRole('navigation', { name: 'Основная навигация' });
  await nav.getByRole('link', { name: 'Сегодня' }).click();
  await nav.getByRole('link', { name: 'Отчёты' }).click(); // экран открывается заново — с текущей недели
  await page.getByRole('radio', { name: 'Месяц' }).check();
  // Прошлый месяц — тот, где все данные; затем ещё два пересчёта (Позже → Раньше).
  for (let run = 0; run < 3; run++) {
    if (run > 0) {
      await page.getByRole('button', { name: 'Позже →' }).click();
      await expect(page.getByText('По состоянию на сегодня')).toBeVisible({ timeout: 30_000 });
    }
    await page.getByRole('button', { name: '← Раньше' }).click();
    await expect(page.getByTestId('summary-tasks')).toContainText('7000 из 10000', { timeout: 30_000 });
  }
  const all = await page.evaluate(() => performance.getEntriesByName('moy-ritm:report').map((e) => e.duration));
  // Замеры полного месяца — каждый второй (между ними — текущий месяц); первый — прогрев.
  const dense = all.filter((_, i) => i % 2 === 0).slice(-3);
  const median = [...dense].sort((a, b) => a - b)[1]!;
  console.log(`Отчёт за месяц (10 000 задач, 20 000 отметок), ${label}, мс: ${dense.map((x) => x.toFixed(0)).join(', ')}; медиана ${median.toFixed(0)}`);
  expect(dense).toHaveLength(3);
  expect(median, label).toBeLessThanOrEqual(limit);
}

// Пороги п. 15.2: ≤ 500 мс (настольное) и ≤ 1 000 мс (мобильное) — в эталонном окружении, сверяются на шаге 7.
// Скорость IndexedDB в контейнерах CI сильно плавает (между двумя контейнерами одного дня — в 1,5–2 раза), поэтому здесь
// замер и защита от грубой регрессии: 2 000 мс без замедления и 3 000 мс при замедлении CPU ×4.
test.describe('производительность отчётов (п. 15.2)', () => {
  test('@perf 10 000 задач и 20 000 отметок: ≤ 500 мс без замедления, ≤ 1 000 мс при CPU ×4', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'замеры и CDP — в Chromium');
    test.setTimeout(240_000);
    await createProfile(page);
    await seedDense(page);

    await measureReports(page, 'настольное', perfLimit(500, 2000));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await measureReports(page, 'мобильное (CPU ×4)', perfLimit(1000, 3000));
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  });

  test('@perf копия такого объёма (~11 МБ): восстановление и экспорт ≤ 3 с, тот же отчёт (лимит 25 МБ, п. 4.4, 15.2)', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'замеры — в Chromium');
    test.setTimeout(240_000);
    await createProfile(page);
    const ms = await restoreDense(page);
    console.log(`Восстановление копии ~11 МБ (10 000 задач, 20 000 отметок), мс: ${ms}`);
    expect(ms, 'импорт').toBeLessThanOrEqual(perfLimit(3000, 180_000));
    await page.evaluate(() => performance.clearMeasures('moy-ritm:report'));
    const nav = page.getByRole('navigation', { name: 'Основная навигация' });
    await nav.getByRole('link', { name: 'Отчёты' }).click();
    await page.getByRole('radio', { name: 'Месяц' }).check();
    await page.getByRole('button', { name: '← Раньше' }).click();
    await expect(page.getByTestId('summary-tasks')).toContainText('7000 из 10000', { timeout: 30_000 });
    await expect(page.getByTestId('summary-tasks')).toContainText('70%');
    const report = await page.evaluate(() => performance.getEntriesByName('moy-ritm:report').at(-1)?.duration ?? -1);
    console.log(`Отчёт за месяц сразу после восстановления, мс: ${report.toFixed(0)}`);

    // Экспорт той же фикстуры (п. 15.2): от нажатия до готового файла.
    await openSettings(page);
    const started = Date.now();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Скачать резервную копию' }).first().click()]);
    const exportMs = Date.now() - started;
    expect((await download.createReadStream()) !== null).toBe(true);
    console.log(`Экспорт копии ~11 МБ, мс: ${exportMs}`);
    expect(exportMs, 'экспорт').toBeLessThanOrEqual(perfLimit(3000, 30_000));
  });
});
