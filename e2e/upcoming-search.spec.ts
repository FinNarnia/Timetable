import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { chooseBackupFile, createProfile, expect, openSettings, PERF_STRICT, perfLimit, test } from './fixtures';

// Пятница, 9 октября 2026: завтра — сб 10 окт, следующая неделя — пн 12 … вс 18 окт.
const START = new Date('2026-10-09T09:00:00');

const nav = (page: Page) => page.getByRole('navigation', { name: 'Основная навигация' });
const announcer = (page: Page) => page.getByTestId('announcer');
const toastRegion = (page: Page) => page.locator('.toast-region');

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
  await expect(page.getByTestId('progress-caption')).toBeVisible();
}

async function quickAdd(page: Page, title: string, target: 'Сегодня' | 'Завтра' | 'Без даты' = 'Сегодня') {
  const form = page.getByRole('form', { name: 'Быстрое добавление задачи' });
  await form.getByRole('radio', { name: target, exact: true }).check();
  await form.getByLabel('Новая задача').fill(title);
  await form.getByLabel('Новая задача').press('Enter');
  await expect(form.getByLabel('Новая задача')).toHaveValue('');
}

async function addDated(page: Page, title: string, date: string, time?: string) {
  await page.getByRole('button', { name: 'Подробнее…' }).click();
  const d = page.getByRole('dialog', { name: 'Новая задача' });
  await d.getByLabel('Название', { exact: true }).fill(title);
  await d.getByRole('radio', { name: time ? 'Дата и время' : 'Дата', exact: true }).check();
  await d.locator('input[type="date"]').fill(date);
  if (time) await d.getByLabel('Время', { exact: true }).fill(time);
  await d.getByRole('button', { name: 'Сохранить' }).click();
  await expect(d).toBeHidden();
}

const search = (page: Page) => page.getByLabel('Поиск задач');

test.describe('«Предстоящие» (п. 7.3)', () => {
  test('пустое состояние: быстрое добавление со сроком «Завтра»', async ({ page }) => {
    await page.clock.install({ time: START });
    await createProfile(page);
    await openUpcoming(page);
    await expect(page.getByRole('heading', { name: 'Здесь появятся задачи на будущие дни' })).toBeVisible();
    const form = page.getByRole('form', { name: 'Быстрое добавление задачи' });
    await expect(form.getByRole('radio', { name: 'Завтра' })).toBeChecked();
    await form.getByLabel('Новая задача').fill('Первая на завтра');
    await form.getByLabel('Новая задача').press('Enter');
    await expect(titles(group(page, 'Завтра'))).toHaveText(['Первая на завтра']);
  });

  test('11.10: задачи по дням с «Завтра», смена даты переносит в новый день; досрочное выполнение', async ({ page }) => {
    await page.clock.install({ time: START });
    await createProfile(page);
    await quickAdd(page, 'Сегодняшняя');
    await quickAdd(page, 'Купить цветы', 'Завтра');
    await addDated(page, 'Встреча', '2026-10-12', '18:00');
    await addDated(page, 'Позвонить в банк', '2026-10-12');
    await addDated(page, 'Отчёт за неделю', '2026-10-15');
    await addDated(page, 'Уже в среду', '2026-10-14');
    await quickAdd(page, 'Когда-нибудь', 'Без даты');

    await openUpcoming(page);
    const headings = page.locator('.task-group .group-title');
    await expect(headings).toHaveText([/^Завтра/, /^пн, 12 окт/, /^ср, 14 окт/, /^чт, 15 окт/]);
    await expect(titles(group(page, 'пн, 12 окт'))).toHaveText(['Встреча', 'Позвонить в банк']);
    await expect(group(page, 'пн, 12 окт').getByTestId('task').first()).toContainText('18:00');
    await expect(page.getByText('Сегодняшняя')).toHaveCount(0);
    await expect(page.getByText('Когда-нибудь')).toHaveCount(0);

    // Открыть задачу на следующей неделе и сменить дату.
    await page.getByRole('button', { name: 'Изменить задачу: Отчёт за неделю' }).click();
    const d = page.getByRole('dialog', { name: 'Изменить задачу' });
    await d.locator('input[type="date"]').fill('2026-10-14');
    await d.getByRole('button', { name: 'Сохранить' }).click();
    await expect(toastRegion(page)).toContainText('Изменения сохранены');
    await expect(group(page, 'чт, 15 окт')).toHaveCount(0);
    await expect(titles(group(page, 'ср, 14 окт'))).toHaveText(['Уже в среду', 'Отчёт за неделю']);

    // Досрочное выполнение: задача уходит с «Предстоящих» и засчитывается сегодня.
    await page.getByRole('checkbox', { name: 'Купить цветы' }).click();
    await expect(group(page, 'Завтра')).toHaveCount(0);
    await openToday(page);
    await expect(titles(group(page, 'Выполнено сегодня'))).toHaveText(['Купить цветы']);
    await expect(page.getByTestId('progress-caption')).toHaveText('1 из 2 задач');

    // После перезагрузки всё на месте.
    await page.reload();
    await openUpcoming(page);
    await expect(page.locator('.task-group .group-title')).toHaveText([/^пн, 12 окт/, /^ср, 14 окт/]);
  });

  test('«Задача создана» ведёт к её дню', async ({ page }) => {
    await page.clock.install({ time: START });
    await createProfile(page);
    for (let i = 1; i <= 12; i++) await addDated(page, `Дело ${i}`, `2026-10-${String(10 + i).padStart(2, '0')}`);
    await addDated(page, 'Отпуск', '2026-11-20');
    const toast = toastRegion(page).locator('.toast').filter({ hasText: 'Задача создана на 20.11.2026' });
    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: 'Открыть день' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Предстоящие' })).toBeVisible();
    const heading = page.getByRole('heading', { name: /^пт, 20 ноя/ });
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport();
  });
});

test.describe('поиск (п. 7.4)', () => {
  test('11.11: любой регистр и ё/е, группы, даты, число найденных, Esc и очистка', async ({ page }) => {
    await page.clock.install({ time: START });
    await createProfile(page);
    await quickAdd(page, 'Нарядить ЁЛКУ');
    await quickAdd(page, 'Купить елочные игрушки', 'Завтра');
    await quickAdd(page, 'Ёлочный базар', 'Без даты');
    await quickAdd(page, 'Полить ёлку');
    await page.getByRole('checkbox', { name: 'Полить ёлку' }).click();
    await quickAdd(page, 'Хлеб');

    await search(page).fill('ЕЛ');
    const results = page.getByTestId('search-results');
    await expect(titles(results.getByRole('region', { name: /^Сегодня/ }))).toHaveText(['Нарядить ЁЛКУ']);
    await expect(titles(results.getByRole('region', { name: /^Предстоящие/ }))).toHaveText(['Купить елочные игрушки']);
    await expect(titles(results.getByRole('region', { name: /^Без даты/ }))).toHaveText(['Ёлочный базар']);
    await expect(titles(results.getByRole('region', { name: /^Выполненные/ }))).toHaveText(['Полить ёлку']);
    await expect(results.getByTestId('task').filter({ hasText: 'игрушки' })).toContainText('Завтра');
    await expect(results.getByTestId('task').filter({ hasText: 'базар' })).toContainText('Без даты');
    await expect(announcer(page)).toHaveText('Найдено задач: 4');
    // Список экрана заменён результатами.
    await expect(page.getByText('Хлеб')).toHaveCount(0);

    // Esc возвращает обычный список.
    await search(page).press('Escape');
    await expect(search(page)).toHaveValue('');
    await expect(results).toHaveCount(0);
    await expect(titles(group(page, 'Сегодня'))).toHaveText(['Нарядить ЁЛКУ', 'Хлеб']);

    // Нет совпадений.
    await search(page).fill('самолёт');
    await expect(page.locator('.empty-text')).toHaveText('Ничего не нашлось по запросу «самолёт»');
    await expect(announcer(page)).toHaveText('Ничего не нашлось по запросу «самолёт»');

    // Кнопка очистки возвращает список и фокус в поле.
    await page.getByRole('button', { name: 'Очистить поиск' }).click();
    await expect(search(page)).toBeFocused();
    await expect(titles(group(page, 'Сегодня'))).toHaveText(['Нарядить ЁЛКУ', 'Хлеб']);

    // Действия из результата: выполнение.
    await search(page).fill('нарядить');
    await page.getByTestId('search-results').getByRole('checkbox', { name: 'Нарядить ЁЛКУ' }).click();
    await expect(titles(page.getByTestId('search-results').getByRole('region', { name: /^Выполненные/ }))).toHaveText([
      'Нарядить ЁЛКУ',
    ]);

    // Поиск есть и на «Предстоящих».
    await openUpcoming(page);
    await search(page).fill('базар');
    await expect(titles(page.getByTestId('search-results'))).toHaveText(['Ёлочный базар']);
    await search(page).press('Escape');
    await expect(titles(group(page, 'Завтра'))).toHaveText(['Купить елочные игрушки']);
  });

  test('выполненная в прошлый день: только просмотр и дублирование', async ({ page }) => {
    await page.clock.install({ time: START });
    await createProfile(page);
    await quickAdd(page, 'Старый отчёт');
    await page.getByRole('checkbox', { name: 'Старый отчёт' }).click();
    await expect(titles(group(page, 'Выполнено сегодня'))).toHaveText(['Старый отчёт']);

    await page.clock.setSystemTime(new Date('2026-10-10T09:00:00'));
    await page.reload();
    await expect(page.getByText('Старый отчёт')).toHaveCount(0);
    await search(page).fill('отчёт');
    const row = page.getByTestId('search-results').getByTestId('task');
    await expect(row).toContainText('пт, 9 окт');
    await expect(row.getByRole('checkbox')).toBeDisabled();
    await row.getByRole('button', { name: 'Действия с задачей «Старый отчёт»' }).click();
    const items = page.locator('.menu .menu-item');
    await expect(items).toHaveText(['Открыть', 'Дублировать']);
    await items.filter({ hasText: 'Открыть' }).click();
    const dialog = page.getByRole('dialog', { name: 'Просмотр задачи' });
    await expect(dialog.getByLabel('Название', { exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Сохранить' })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Закрыть' }).click();

    await row.getByRole('button', { name: 'Действия с задачей «Старый отчёт»' }).click();
    await page.getByRole('button', { name: 'Дублировать', exact: true }).click();
    await expect(toastRegion(page)).toContainText('Копия создана');
    // Копия — активная, на сегодня (дата оригинала в прошлом).
    await expect(titles(page.getByTestId('search-results').getByRole('region', { name: /^Сегодня/ }))).toHaveText(['Старый отчёт']);
  });

  test('@perf 5 000 задач: от окончания задержки ввода до показа результатов ≤ 100 мс (п. 15.2)', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'замеры и CDP — в Chromium');
    test.setTimeout(240_000);
    const dir = resolve('test-results/fixtures');
    mkdirSync(dir, { recursive: true });
    const file = resolve(dir, 'search-5000.json');
    execFileSync('node', ['scripts/seed.mjs', '--tasks', '5000', '--checks', '0', '--habits', '0', '--out', file]);
    await createProfile(page);
    await openSettings(page);
    await chooseBackupFile(page, 'Восстановить из копии', { name: 'search-5000.json', buffer: readFileSync(file) });
    await page.getByRole('dialog', { name: 'Восстановить из копии?' }).getByRole('button', { name: 'Восстановить' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Настройки' })).toBeVisible({ timeout: 30_000 });
    await openToday(page);
    await expect(search(page)).toBeVisible();

    const measureSearch = async (label: string) => {
      const timings: number[] = [];
      // Первый запрос — прогрев (JIT); сравниваем медиану трёх замеров, как в бенчмарке обслуживания дня.
      for (const q of ['номер 7', 'номер 12', 'НОМЕР 4', 'номер 999']) {
        // Замер самого приложения (performance.measure 'moy-ritm:search'): от конца задержки ввода до кадра с результатами.
        // Ввод — внутри страницы, без опроса локаторами Playwright: он занимает тот же поток и искажает замер.
        timings.push(
          await page.evaluate(async (query) => {
            const input = document.querySelector<HTMLInputElement>('input[placeholder="Поиск задач"]')!;
            const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
            const type = (value: string) => {
              setValue.call(input, value);
              input.dispatchEvent(new Event('input', { bubbles: true }));
            };
            type('');
            await new Promise((r) => setTimeout(r, 1500)); // обычный список отрисовался
            performance.clearMeasures('moy-ritm:search');
            return new Promise<number>((done) => {
              const observer = new PerformanceObserver((list) => {
                const entry = list.getEntriesByName('moy-ritm:search')[0];
                if (entry) {
                  observer.disconnect();
                  done(entry.duration);
                }
              });
              observer.observe({ type: 'measure' });
              type(query);
            });
          }, q),
        );
      }
      const measured = timings.slice(1);
      const median = [...measured].sort((a, b) => a - b)[1]!;
      console.log(`Поиск по 5 000 задач после задержки, ${label}, мс: ${measured.map((t) => t.toFixed(1)).join(', ')}; медиана ${median.toFixed(1)}`);
      return median;
    };
    expect(await measureSearch('без замедления'), 'настольное').toBeLessThanOrEqual(perfLimit(100, 200));
    if (PERF_STRICT) {
      // Мобильный профиль: замедление CPU ×4 (эталон п. 15.2).
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const med = await measureSearch('CPU ×4');
      expect(med, 'мобильное').toBeLessThanOrEqual(100);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    }

    // Порции дорисовываются до конца: строк столько, сколько найдено.
    await search(page).fill('номер 4');
    await expect(announcer(page)).toHaveText(/^Найдено задач: \d{4}$/);
    const found = Number((await announcer(page).textContent())!.replace(/\D/g, ''));
    await expect(page.getByTestId('search-results').getByTestId('task')).toHaveCount(found);
  });
});

test.describe('ручная сортировка (п. 6.13)', () => {
  test('11.12: «Выше» из меню и Alt+↑/↓, фокус на задаче, объявление позиции, порядок после перезагрузки', async ({ page }) => {
    await page.clock.install({ time: START });
    await createProfile(page);
    for (const t of ['Первая', 'Вторая', 'Третья']) await quickAdd(page, t);
    await addDated(page, 'Созвон', '2026-10-09', '23:00');
    const today = group(page, 'Сегодня');
    await expect(titles(today)).toHaveText(['Созвон', 'Первая', 'Вторая', 'Третья']);

    // Меню: «Выше».
    const menuBtn = page.getByRole('button', { name: 'Действия с задачей «Третья»' });
    await menuBtn.click();
    await page.getByRole('button', { name: 'Выше', exact: true }).click();
    await expect(titles(today)).toHaveText(['Созвон', 'Первая', 'Третья', 'Вторая']);
    await expect(menuBtn).toBeFocused();
    await expect(announcer(page)).toHaveText('Позиция 3 из 4');

    // Клавиатура: Alt+↑ на чекбоксе, фокус остаётся на нём.
    const check = page.getByRole('checkbox', { name: 'Третья' });
    await check.focus();
    await page.keyboard.press('Alt+ArrowUp');
    await expect(titles(today)).toHaveText(['Созвон', 'Третья', 'Первая', 'Вторая']);
    await expect(check).toBeFocused();
    await expect(announcer(page)).toHaveText('Позиция 2 из 4');
    // Выше — задача со временем: дальше некуда.
    await page.keyboard.press('Alt+ArrowUp');
    await expect(titles(today)).toHaveText(['Созвон', 'Третья', 'Первая', 'Вторая']);
    await page.keyboard.press('Alt+ArrowDown');
    await expect(titles(today)).toHaveText(['Созвон', 'Первая', 'Третья', 'Вторая']);
    await expect(check).toBeFocused();

    // На краях команды недоступны, у задачи со временем их нет.
    await page.getByRole('button', { name: 'Действия с задачей «Первая»' }).click();
    await expect(page.getByRole('button', { name: 'Выше', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Ниже', exact: true })).toBeEnabled();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Действия с задачей «Созвон»' }).click();
    await expect(page.getByRole('button', { name: 'Выше', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.reload();
    await expect(titles(group(page, 'Сегодня'))).toHaveText(['Созвон', 'Первая', 'Третья', 'Вторая']);
  });

  test('сортировка внутри дня на «Предстоящих» и в группе «Без даты»', async ({ page }) => {
    await page.clock.install({ time: START });
    await createProfile(page);
    await quickAdd(page, 'Б1', 'Без даты');
    await quickAdd(page, 'Б2', 'Без даты');
    const b2 = page.getByRole('checkbox', { name: 'Б2' });
    await b2.focus();
    await page.keyboard.press('Alt+ArrowUp');
    await expect(titles(group(page, 'Без даты'))).toHaveText(['Б2', 'Б1']);

    for (const t of ['З1', 'З2', 'З3']) await quickAdd(page, t, 'Завтра');
    await openUpcoming(page);
    const tomorrow = group(page, 'Завтра');
    const z1 = page.getByRole('button', { name: 'Изменить задачу: З1' });
    await z1.focus();
    await page.keyboard.press('Alt+ArrowDown');
    await page.keyboard.press('Alt+ArrowDown');
    await expect(titles(tomorrow)).toHaveText(['З2', 'З3', 'З1']);
    await expect(z1).toBeFocused();
    await expect(announcer(page)).toHaveText('Позиция 3 из 3');
    await page.reload();
    await expect(titles(group(page, 'Завтра'))).toHaveText(['З2', 'З3', 'З1']);
  });

  test('поиск не даёт переставлять задачи', async ({ page }) => {
    await page.clock.install({ time: START });
    await createProfile(page);
    await quickAdd(page, 'Альфа');
    await quickAdd(page, 'Альфа два');
    await search(page).fill('альфа');
    await page.getByTestId('search-results').getByRole('button', { name: 'Действия с задачей «Альфа два»' }).click();
    await expect(page.getByRole('button', { name: 'Выше', exact: true })).toHaveCount(0);
  });
});
