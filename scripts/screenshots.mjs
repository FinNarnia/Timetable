#!/usr/bin/env node
// Скриншоты ключевых экранов для ручной проверки шага. Нужен запущенный `pnpm preview`.
// Использование: node scripts/screenshots.mjs step-1
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const step = process.argv[2] ?? 'current';
const out = join('docs', 'screenshots', step);
mkdirSync(out, { recursive: true });
const BASE = 'http://localhost:4173';
const sample = readFileSync('fixtures/backups/sample.json');

const browser = await chromium.launch();

async function shoot(width, height, name, fn) {
  const context = await browser.newContext({ viewport: { width, height }, locale: 'ru-RU', timezoneId: 'Europe/Moscow', deviceScaleFactor: 2 });
  const page = await context.newPage();
  await fn(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, `${name}-${width}.png`), fullPage: true });
  await context.close();
}

async function profile(page, name = 'Анна') {
  await page.goto(BASE);
  await page.getByLabel('Как вас зовут?').fill(name);
  await page.getByRole('button', { name: 'Начать' }).click();
  await page.getByRole('heading', { level: 1, name: new RegExp(name) }).waitFor();
}

const at = async (page, iso) => page.clock.install({ time: new Date(iso) });

async function quick(page, title, target = 'Сегодня') {
  const form = page.getByRole('form', { name: 'Быстрое добавление задачи' });
  await form.getByRole('radio', { name: target, exact: true }).check();
  await form.getByLabel('Новая задача').fill(title);
  await form.getByLabel('Новая задача').press('Enter');
  await page.getByText(title, { exact: true }).first().waitFor().catch(() => {});
}

async function category(page, name, color) {
  await page.getByRole('link', { name: 'Настройки' }).click();
  await page.getByRole('button', { name: 'Новая категория' }).click();
  const d = page.getByRole('dialog', { name: 'Новая категория' });
  await d.getByLabel('Название', { exact: true }).fill(name);
  await d.getByRole('radio', { name: color }).check();
  await d.getByRole('button', { name: 'Сохранить' }).click();
  await d.waitFor({ state: 'hidden' });
}

async function detailed(page, { title, time, priority, cat, note }) {
  await page.getByRole('button', { name: 'Подробнее…' }).click();
  const d = page.getByRole('dialog', { name: 'Новая задача' });
  await d.getByLabel('Название', { exact: true }).fill(title);
  if (note) await d.getByLabel('Заметка').fill(note);
  if (time) {
    await d.getByRole('radio', { name: 'Дата и время' }).check();
    await d.getByLabel('Время', { exact: true }).fill(time);
  }
  if (priority) await d.getByRole('radio', { name: priority }).check();
  if (cat) await d.getByLabel('Категория', { exact: true }).selectOption({ label: cat });
  await d.getByRole('button', { name: 'Сохранить' }).click();
  await d.waitFor({ state: 'hidden' });
}


if (step === 'step-1') {
for (const [w, h] of [[360, 800], [768, 1024], [1280, 800]]) {
  await shoot(w, h, '01-first-run', async (page) => {
    await page.goto(BASE);
    await page.getByLabel('Как вас зовут?').waitFor();
  });
  await shoot(w, h, '02-today', (page) => profile(page));
  await shoot(w, h, '03-settings', async (page) => {
    await profile(page);
    await page.getByRole('link', { name: 'Настройки' }).click();
    await page.getByTestId('persistence-status').filter({ hasNotText: '…' }).waitFor();
  });
}

await shoot(360, 800, '04-habits-empty', async (page) => {
  await profile(page);
  await page.getByRole('link', { name: 'Привычки' }).click();
});
await shoot(360, 800, '05-first-run-error', async (page) => {
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Начать' }).click();
  await page.getByText('Введите имя').waitFor();
});
await shoot(360, 800, '06-import-summary', async (page) => {
  await profile(page);
  await page.getByRole('link', { name: 'Настройки' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Восстановить из копии' }).click()]);
  await chooser.setFiles({ name: 'sample.json', mimeType: 'application/json', buffer: sample });
  await page.getByRole('dialog', { name: 'Восстановить из копии?' }).waitFor();
});
await shoot(360, 800, '07-import-error', async (page) => {
  await profile(page);
  await page.getByRole('link', { name: 'Настройки' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Восстановить из копии' }).click()]);
  await chooser.setFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await page.getByRole('dialog', { name: 'Не получилось' }).waitFor();
});
await shoot(360, 800, '08-delete-all', async (page) => {
  await profile(page);
  await page.getByRole('link', { name: 'Настройки' }).click();
  await page.getByRole('button', { name: 'Удалить все данные' }).click();
  await page.getByRole('dialog').waitFor();
});
await shoot(360, 800, '09-storage-unavailable', async (page) => {
  await page.addInitScript(() => Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }));
  await page.goto(BASE);
  await page.getByRole('alert').waitFor();
});

}

if (step === 'step-2') {

/** Типичный день: время (одно прошло), приоритеты, категории, без даты, выполненные. */
async function typicalDay(page) {
  await at(page, '2026-10-09T13:20:00');
  await profile(page, 'Мария');
  await category(page, 'Работа', 'Синий');
  await category(page, 'Дом', 'Зелёный');
  await page.getByRole('link', { name: 'Сегодня' }).click();
  await detailed(page, { title: 'Созвон с командой', time: '10:00', cat: 'Работа' });
  await detailed(page, { title: 'Отправить отчёт', time: '16:30', priority: 'Высокий', cat: 'Работа' });
  await detailed(page, { title: 'Забрать посылку', cat: 'Дом', priority: 'Низкий' });
  await quick(page, 'Купить продукты на неделю');
  await quick(page, 'Позвонить маме');
  await quick(page, 'Прочитать статью про сон', 'Без даты');
  await page.getByRole('checkbox', { name: 'Позвонить маме' }).click();
  await page.getByRole('checkbox', { name: 'Созвон с командой' }).click();
  await page.waitForTimeout(4500); // тосты ушли
  await page.mouse.move(0, 0);
}

for (const [w, h] of [[360, 800], [768, 1024], [1280, 800]]) {
  await shoot(w, h, '01-today-tasks', typicalDay);
  await shoot(w, h, '02-task-form', async (page) => {
    await typicalDay(page);
    await page.getByRole('button', { name: 'Изменить задачу: Отправить отчёт' }).click();
  });
}
await shoot(360, 800, '03-ring-partial', async (page) => {
  await profile(page);
  for (const t of ['Первая', 'Вторая', 'Третья']) await quick(page, t);
  await page.getByRole('checkbox', { name: 'Первая' }).click();
  await page.waitForTimeout(4500);
});
await shoot(360, 800, '04-ring-100', async (page) => {
  await profile(page);
  for (const t of ['Первая', 'Вторая']) await quick(page, t);
  for (const t of ['Первая', 'Вторая']) await page.getByRole('checkbox', { name: t }).click();
  await page.waitForTimeout(4500);
});
await shoot(360, 800, '05-form-errors', async (page) => {
  await profile(page);
  await page.getByRole('button', { name: 'Подробнее…' }).click();
  const d = page.getByRole('dialog', { name: 'Новая задача' });
  await d.getByRole('radio', { name: 'Дата и время' }).check();
  await d.getByRole('button', { name: 'Сохранить' }).click();
  await d.getByText('Введите название задачи').waitFor();
});
await shoot(360, 800, '06-form-new-category', async (page) => {
  await profile(page);
  await category(page, 'Ёлка', 'Зелёный');
  await page.getByRole('link', { name: 'Сегодня' }).click();
  await page.getByRole('button', { name: 'Подробнее…' }).click();
  const d = page.getByRole('dialog', { name: 'Новая задача' });
  await d.getByLabel('Название', { exact: true }).fill('Нарядить');
  await d.getByLabel('Категория', { exact: true }).selectOption({ label: '+ Новая категория' });
  await d.getByLabel('Название категории').fill('елка');
  await d.getByRole('button', { name: 'Создать категорию' }).click();
  await d.getByText('Категория с таким названием уже есть').waitFor();
});
await shoot(360, 800, '07-unsaved-confirm', async (page) => {
  await profile(page);
  await page.getByRole('button', { name: 'Подробнее…' }).click();
  await page.getByRole('dialog', { name: 'Новая задача' }).getByLabel('Название', { exact: true }).fill('Черновик');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'Закрыть без сохранения?' }).waitFor();
});
await shoot(360, 800, '08-task-menu', async (page) => {
  await typicalDay(page);
  await page.getByRole('button', { name: 'Действия с задачей «Отправить отчёт»' }).click();
});
await shoot(360, 800, '09-undo-toast', async (page) => {
  await typicalDay(page);
  await page.getByRole('button', { name: 'Действия с задачей «Забрать посылку»' }).click();
  await page.getByRole('button', { name: 'Удалить', exact: true }).click();
  await page.getByText('Задача удалена').hover();
});
await shoot(360, 800, '10-settings-categories', async (page) => {
  await typicalDay(page);
  await page.getByRole('link', { name: 'Настройки' }).click();
  await page.getByRole('region', { name: 'Категории' }).scrollIntoViewIfNeeded();
});
await shoot(360, 800, '11-delete-category', async (page) => {
  await typicalDay(page);
  await page.getByRole('link', { name: 'Настройки' }).click();
  await page.getByRole('button', { name: 'Удалить категорию «Работа»' }).click();
});
await shoot(360, 800, '12-long-title', async (page) => {
  await profile(page);
  await quick(page, 'Ж'.repeat(120));
  await quick(page, 'Очень длинное название задачи, которое занимает несколько строк и проверяет перенос текста в списке');
  await page.waitForTimeout(4500);
});
await shoot(360, 800, '13-time-passed', async (page) => {
  await at(page, '2026-10-09T10:00:00');
  await profile(page);
  await detailed(page, { title: 'Созвон', time: '10:30' });
  await page.clock.runFor('31:00');
  await page.getByText('Время прошло').waitFor();
});
}


if (step === 'step-3') {
  async function dated(page, title, date, time) {
    await page.getByRole('button', { name: 'Подробнее…' }).click();
    const d = page.getByRole('dialog', { name: 'Новая задача' });
    await d.getByLabel('Название', { exact: true }).fill(title);
    await d.getByRole('radio', { name: time ? 'Дата и время' : 'Дата', exact: true }).check();
    await d.locator('input[type="date"]').fill(date);
    if (time) await d.getByLabel('Время', { exact: true }).fill(time);
    await d.getByRole('button', { name: 'Сохранить' }).click();
    await d.waitFor({ state: 'hidden' });
  }

  /** Неделя вперёд: несколько дней, время, категории, задачи без даты, выполненные. */
  async function week(page) {
    await at(page, '2026-10-09T11:00:00');
    await profile(page, 'Мария');
    await category(page, 'Работа', 'Синий');
    await category(page, 'Дом', 'Зелёный');
    await page.getByRole('link', { name: 'Сегодня' }).click();
    await quick(page, 'Купить ёлочные игрушки');
    await quick(page, 'Позвонить маме');
    await quick(page, 'Забрать посылку', 'Завтра');
    await quick(page, 'Испечь пирог', 'Завтра');
    await dated(page, 'Планёрка', '2026-10-12', '10:00');
    await dated(page, 'Отправить отчёт', '2026-10-12');
    await dated(page, 'Записаться к врачу', '2026-10-14');
    await dated(page, 'Ёлочный базар', '2026-10-17');
    await dated(page, 'Купить билеты на Новый год', '2026-12-20');
    await quick(page, 'Прочитать про ёлки', 'Без даты');
    await page.getByRole('checkbox', { name: 'Позвонить маме' }).click();
    await page.waitForTimeout(5500);
    await page.mouse.move(0, 0);
  }

  for (const [w, h] of [[360, 800], [768, 1024], [1280, 800]]) {
    await shoot(w, h, '01-upcoming', async (page) => {
      await week(page);
      await page.getByRole('link', { name: 'Предстоящие' }).click();
      await page.getByRole('heading', { name: 'Завтра' }).waitFor();
    });
    await shoot(w, h, '02-search', async (page) => {
      await week(page);
      await page.getByLabel('Поиск задач').fill('ЕЛ');
      await page.getByTestId('search-results').waitFor();
    });
  }
  await shoot(360, 800, '03-upcoming-empty', async (page) => {
    await profile(page);
    await page.getByRole('link', { name: 'Предстоящие' }).click();
    await page.getByRole('heading', { name: 'Здесь появятся задачи на будущие дни' }).waitFor();
  });
  await shoot(360, 800, '04-search-nothing', async (page) => {
    await week(page);
    await page.getByLabel('Поиск задач').fill('самолёт');
    await page.getByText('Ничего не нашлось', { exact: false }).first().waitFor();
  });
  await shoot(360, 800, '05-menu-move', async (page) => {
    await week(page);
    await quick(page, 'Ещё одна задача');
    await page.waitForTimeout(4500);
    await page.getByRole('button', { name: 'Действия с задачей «Ещё одна задача»' }).click();
  });
  await shoot(360, 800, '06-readonly-view', async (page) => {
    await week(page);
    await page.clock.setSystemTime(new Date('2026-10-10T09:00:00'));
    await page.reload();
    await page.getByLabel('Поиск задач').fill('маме');
    await page.getByRole('button', { name: 'Открыть задачу: Позвонить маме' }).click();
    await page.getByRole('dialog', { name: 'Просмотр задачи' }).waitFor();
  });
  await shoot(360, 800, '07-created-link', async (page) => {
    await week(page);
    await dated(page, 'Поздравить Олю', '2026-10-21');
    await page.getByText('Задача создана на 21.10.2026').hover();
  });
  await shoot(360, 800, '08-search-readonly-row', async (page) => {
    await week(page);
    await page.clock.setSystemTime(new Date('2026-10-10T09:00:00'));
    await page.reload();
    await page.getByLabel('Поиск задач').fill('о');
    await page.getByTestId('search-results').waitFor();
  });
}


if (step === 'step-4') {
  async function series(page, title, frequency, time) {
    await page.getByRole('button', { name: 'Подробнее…' }).click();
    const d = page.getByRole('dialog', { name: 'Новая задача' });
    await d.getByLabel('Название', { exact: true }).fill(title);
    await d.getByRole('radio', { name: time ? 'Дата и время' : 'Дата', exact: true }).check();
    if (time) await d.getByLabel('Время', { exact: true }).fill(time);
    await d.getByLabel('Повторение').selectOption({ label: frequency });
    await d.getByRole('button', { name: 'Сохранить' }).click();
    await d.waitFor({ state: 'hidden' });
  }

  /** Три дня: задачи переносятся, серии работают. */
  async function threeDays(page) {
    await at(page, '2026-10-09T09:00:00');
    await profile(page, 'Мария');
    await quick(page, 'Разобрать почту');
    await quick(page, 'Позвонить в банк');
    await series(page, 'Зарядка', 'Каждый день', '07:30');
    await series(page, 'Полить цветы', 'По дням недели');
    for (const day of ['10', '11', '12']) {
      await page.clock.setSystemTime(new Date(`2026-10-${day}T09:00:00`));
      await page.reload();
      await page.getByTestId('progress-caption').waitFor();
    }
    await quick(page, 'Купить хлеб');
    await page.getByRole('button', { name: 'Изменить задачу: Позвонить в банк' }).click();
    const f = page.getByRole('dialog', { name: 'Изменить задачу' });
    await f.getByRole('button', { name: 'Отмена' }).click();
    await page.waitForTimeout(4500);
    await page.mouse.move(0, 0);
  }

  for (const [w, h] of [[360, 800], [768, 1024], [1280, 800]]) {
    await shoot(w, h, '01-today-moved', threeDays);
  }
  for (const [w, h] of [[360, 800], [1280, 800]]) {
    await shoot(w, h, '02-form-repeat', async (page) => {
      await at(page, '2026-10-09T09:00:00');
      await profile(page);
      await page.getByRole('button', { name: 'Подробнее…' }).click();
      const d = page.getByRole('dialog', { name: 'Новая задача' });
      await d.getByLabel('Название', { exact: true }).fill('Бассейн');
      await d.getByRole('radio', { name: 'Дата', exact: true }).check();
      await d.getByLabel('Повторение').selectOption({ label: 'По дням недели' });
      await d.getByRole('checkbox', { name: 'понедельник' }).check();
      await d.getByRole('checkbox', { name: 'среда' }).check();
      await d.getByLabel('Дата окончания (необязательно)').fill('2026-12-31');
      await d.getByLabel('Повторение').scrollIntoViewIfNeeded();
    });
  }
  await shoot(360, 800, '03-choice-edit', async (page) => {
    await threeDays(page);
    await page.getByRole('button', { name: 'Изменить задачу: Зарядка' }).first().click();
    const f = page.getByRole('dialog', { name: 'Изменить задачу' });
    await f.getByLabel('Название', { exact: true }).fill('Зарядка в парке');
    await f.getByRole('button', { name: 'Сохранить' }).click();
    await page.getByRole('dialog', { name: 'Изменить повторяющуюся задачу' }).waitFor();
  });
  await shoot(360, 800, '04-choice-rule', async (page) => {
    await threeDays(page);
    await page.getByRole('button', { name: 'Изменить задачу: Зарядка' }).first().click();
    const f = page.getByRole('dialog', { name: 'Изменить задачу' });
    await f.getByLabel('Повторение').selectOption({ label: 'Каждый месяц' });
    await f.getByRole('button', { name: 'Сохранить' }).click();
    await page.getByRole('dialog', { name: 'Изменить повторяющуюся задачу' }).waitFor();
  });
  await shoot(360, 800, '05-choice-delete', async (page) => {
    await threeDays(page);
    await page.getByRole('button', { name: 'Действия с задачей «Зарядка»' }).first().click();
    await page.getByRole('button', { name: 'Удалить', exact: true }).click();
    await page.getByRole('dialog', { name: 'Удалить повторяющуюся задачу' }).waitFor();
  });
  await shoot(360, 800, '06-upcoming-series', async (page) => {
    await threeDays(page);
    await page.getByRole('link', { name: 'Предстоящие' }).click();
    await page.getByText('Повторяющиеся задачи показаны на 2 недели вперёд').waitFor();
  });
  await shoot(360, 800, '07-search-series', async (page) => {
    await threeDays(page);
    await page.getByLabel('Поиск задач').fill('зарядка');
    await page.getByTestId('search-results').waitFor();
  });
  await shoot(360, 800, '08-conflict', async (page) => {
    await profile(page);
    await quick(page, 'Общая задача');
    const other = await page.context().newPage();
    await other.goto(BASE);
    await page.getByRole('button', { name: 'Изменить задачу: Общая задача' }).click();
    await page.getByRole('dialog', { name: 'Изменить задачу' }).getByLabel('Заметка').fill('моя версия');
    await other.getByRole('button', { name: 'Изменить задачу: Общая задача' }).click();
    await other.getByRole('dialog', { name: 'Изменить задачу' }).getByLabel('Заметка').fill('другая');
    await other.getByRole('dialog', { name: 'Изменить задачу' }).getByRole('button', { name: 'Сохранить' }).click();
    await page.getByRole('dialog', { name: 'Изменить задачу' }).getByRole('button', { name: 'Сохранить' }).click();
    await page.getByRole('dialog', { name: 'Задачу изменили в другой вкладке' }).waitFor();
  });
}


if (step === 'step-5') {
  async function habit(page, title, type, fill) {
    await page.getByRole('button', { name: /^(Создать первую привычку|Новая привычка)$/ }).click();
    const d = page.getByRole('dialog', { name: 'Новая привычка' });
    await d.getByLabel('Название').fill(title);
    await d.getByRole('radio', { name: type }).check();
    if (fill) await fill(d);
    await d.getByRole('button', { name: 'Создать' }).click();
    await d.waitFor({ state: 'hidden' });
  }
  const tap = (page, title, day) =>
    page.locator('.habit-card').filter({ has: page.getByRole('button', { name: `Изменить привычку: ${title}` }) }).getByRole('button', { name: day }).click();

  /** Привычки, созданные в понедельник прошлой недели, сегодня — среда. */
  async function habits(page) {
    await at(page, '2026-10-05T09:00:00');
    await profile(page, 'Мария');
    await page.getByRole('link', { name: 'Привычки' }).click();
    await habit(page, 'Пить воду', 'Каждый день');
    await habit(page, 'Бассейн', 'По дням недели', async (d) => {
      await d.getByRole('checkbox', { name: 'понедельник' }).check();
      await d.getByRole('checkbox', { name: 'среда' }).check();
      await d.getByRole('checkbox', { name: 'пятница' }).check();
    });
    await habit(page, 'Пробежка', 'Цель на неделю');
    await habit(page, 'Читать 20 минут', 'Каждый день');
    await page.clock.setSystemTime(new Date('2026-10-14T09:00:00'));
    await page.reload();
    await page.getByRole('heading', { level: 1, name: 'Привычки' }).waitFor();
    for (const day of [/^Понедельник, 12/, /^Вторник, 13/, /^Среда, 14/]) await tap(page, 'Пить воду', day);
    await tap(page, 'Бассейн', /^Понедельник, 12/);
    await tap(page, 'Пробежка', /^Вторник, 13/);
    await tap(page, 'Пробежка', /^Среда, 14/);
    await tap(page, 'Читать 20 минут', /^Вторник, 13/);
    await page.waitForTimeout(4500);
    await page.mouse.move(0, 0);
  }

  for (const [w, h] of [[360, 800], [768, 1024], [1280, 800]]) {
    await shoot(w, h, '01-habits-week', habits);
  }
  await shoot(360, 800, '02-habits-hint', async (page) => {
    await habits(page);
    await page.locator('.habit-card').first().getByRole('button', { name: /^Четверг, 15/ }).click({ force: true });
  });
  await shoot(360, 800, '03-habits-previous-week', async (page) => {
    await habits(page);
    await page.getByRole('radio', { name: 'Прошлая неделя' }).check();
  });
  for (const [type, name] of [['Каждый день', '04-form-daily'], ['По дням недели', '05-form-weekdays'], ['Цель на неделю', '06-form-target']]) {
    await shoot(360, 800, name, async (page) => {
      await profile(page);
      await page.getByRole('link', { name: 'Привычки' }).click();
      await page.getByRole('button', { name: 'Создать первую привычку' }).click();
      const d = page.getByRole('dialog', { name: 'Новая привычка' });
      await d.getByLabel('Название').fill('Бассейн');
      await d.getByRole('radio', { name: type }).check();
      if (type === 'По дням недели') await d.getByRole('checkbox', { name: 'вторник' }).check();
    });
  }
  await shoot(360, 800, '07-habits-empty', async (page) => {
    await profile(page);
    await page.getByRole('link', { name: 'Привычки' }).click();
    await page.getByRole('heading', { name: 'Привычек пока нет' }).waitFor();
  });
  await shoot(360, 800, '08-archive', async (page) => {
    await habits(page);
    await page.getByRole('button', { name: 'Действия с привычкой «Читать 20 минут»' }).click();
    await page.getByRole('button', { name: 'Убрать в архив' }).click();
    await page.getByRole('dialog', { name: 'Убрать в архив?' }).getByRole('button', { name: 'Убрать в архив' }).click();
    await page.waitForTimeout(5500);
    await page.locator('.archive-block summary').click();
  });
  await shoot(360, 800, '09-today-habits', async (page) => {
    await habits(page);
    await page.getByRole('link', { name: 'Сегодня' }).click();
    await quick(page, 'Разобрать почту');
    await page.waitForTimeout(4500);
    await page.getByRole('region', { name: /^Привычки на сегодня/ }).scrollIntoViewIfNeeded();
  });
}

await browser.close();
console.log(`Скриншоты: ${out}`);
