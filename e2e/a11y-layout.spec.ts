import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { chooseBackupFile, createProfile, expect, openSettings, pick, seedReportCase, test } from './fixtures';

const WIDTHS = [360, 768, 1280] as const;
const sample = readFileSync(resolve('fixtures/backups/sample.json'));

async function checkScreen(page: Page, label: string, include?: string) {
  // Нет горизонтальной прокрутки страницы (п. 12.3).
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label}: горизонтальная прокрутка`).toBeLessThanOrEqual(0);
  // axe: нет нарушений уровней serious и critical (п. 15.4).
  const builder = new AxeBuilder({ page });
  if (include) builder.include(include);
  const results = await builder.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    `${label}: нарушения доступности`,
  ).toEqual([]);
}

for (const width of WIDTHS) {
  test.describe(`ширина ${width} px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test('все экраны и диалоги: доступность и отсутствие горизонтальной прокрутки', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByLabel('Как вас зовут?')).toBeVisible();
      await checkScreen(page, 'первый запуск');

      // Ошибка валидации тоже проверяется.
      await page.getByRole('button', { name: 'Начать' }).click();
      await expect(page.getByText('Введите имя')).toBeVisible();
      await checkScreen(page, 'первый запуск с ошибкой');

      await createProfile(page, 'Константин Константинопольский');
      await checkScreen(page, 'Сегодня');

      const nav = page.getByRole('navigation', { name: 'Основная навигация' });
      for (const name of ['Предстоящие', 'Привычки', 'Отчёты', 'Настройки']) {
        await nav.getByRole('link', { name }).click();
        await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
        await checkScreen(page, name);
      }

      await chooseBackupFile(page, 'Восстановить из копии', { name: 'sample.json', buffer: sample });
      await expect(page.getByRole('dialog', { name: 'Восстановить из копии?' })).toBeVisible();
      await checkScreen(page, 'сводка копии');
      await page.getByRole('dialog').getByRole('button', { name: 'Отмена' }).click();

      await page.getByRole('button', { name: 'Удалить все данные' }).click();
      await expect(page.getByRole('dialog', { name: 'Удалить все данные?' })).toBeVisible();
      await checkScreen(page, 'удаление данных');
      await page.keyboard.press('Escape');

      await chooseBackupFile(page, 'Восстановить из копии', { name: 'bad.json', buffer: Buffer.from('{}') });
      await expect(page.getByRole('dialog', { name: 'Не получилось' })).toBeVisible();
      await checkScreen(page, 'ошибка файла');
    });

    test('задачи: «Сегодня» с задачами, форма, категории — доступность, вёрстка, длинное название', async ({ page }) => {
      await createProfile(page);
      const long = 'Ж'.repeat(120);
      const quick = page.getByLabel('Новая задача');
      await quick.fill(long);
      await quick.press('Enter');
      await quick.fill('Обычная задача');
      await quick.press('Enter');
      await page.getByRole('form', { name: 'Быстрое добавление задачи' }).getByRole('radio', { name: 'Без даты' }).check();
      await quick.fill('Без срока');
      await quick.press('Enter');
      await page.getByRole('checkbox', { name: 'Обычная задача' }).click();
      await expect(page.getByTestId('progress-caption')).toHaveText('1 из 2 задач');

      // Длинное название без пробелов переносится и не вылезает за строку задачи (п. 12.3).
      const row = page.getByTestId('task').filter({ hasText: long });
      const fits = await row.evaluate((li) => {
        const box = li.getBoundingClientRect();
        return [...li.querySelectorAll('*')].every((el) => el.getBoundingClientRect().right <= box.right + 0.5);
      });
      expect(fits, 'длинное название внутри строки').toBe(true);
      await checkScreen(page, 'Сегодня с задачами');

      await page.getByRole('button', { name: `Действия с задачей «${long}»` }).click();
      // Открытое меню перекрывает соседние строки — проверяем само меню и его кнопку.
      await checkScreen(page, 'меню задачи', '.task-menu:has(.menu)');
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: 'Подробнее…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Новая задача' });
      await pick(dialog.getByRole('radio', { name: 'Дата и время' }));
      await dialog.getByRole('button', { name: 'Сохранить' }).click();
      await expect(dialog.getByText('Введите название задачи')).toBeVisible();
      await dialog.getByLabel('Категория', { exact: true }).selectOption({ label: '+ Новая категория' });
      await checkScreen(page, 'форма задачи с ошибками и новой категорией');
      await page.keyboard.press('Escape');
      await page.getByRole('dialog', { name: 'Закрыть без сохранения?' }).getByRole('button', { name: 'Закрыть без сохранения' }).click();

      await page.getByRole('button', { name: `Изменить задачу: ${long}` }).click();
      await checkScreen(page, 'форма с длинным названием');
      await page.keyboard.press('Escape');

      await openSettings(page);
      const block = page.getByRole('region', { name: 'Категории' });
      await block.getByRole('button', { name: 'Новая категория' }).click();
      await page.getByRole('dialog', { name: 'Новая категория' }).getByLabel('Название', { exact: true }).fill('Очень длинная категория дом!!');
      await page.getByRole('dialog', { name: 'Новая категория' }).getByRole('button', { name: 'Сохранить' }).click();
      await expect(block).toContainText('Очень длинная категория дом!!');
      await checkScreen(page, 'настройки с категориями');
      await block.getByRole('button', { name: /^Удалить категорию/ }).click();
      await checkScreen(page, 'подтверждение удаления категории');
    });

    test('«Предстоящие», поиск, просмотр: доступность и вёрстка', async ({ page }) => {
      await page.clock.install({ time: new Date('2026-10-09T09:00:00') });
      await createProfile(page);
      const nav = page.getByRole('navigation', { name: 'Основная навигация' });
      await nav.getByRole('link', { name: 'Предстоящие' }).click();
      await expect(page.getByRole('heading', { name: 'Здесь появятся задачи на будущие дни' })).toBeVisible();
      await checkScreen(page, 'Предстоящие пусто');

      const quick = page.getByLabel('Новая задача');
      await quick.fill('Ж'.repeat(120));
      await quick.press('Enter');
      await expect(page.getByTestId('task')).toHaveCount(1);
      // Поле быстрого добавления на «Предстоящих» есть только в пустом состоянии (п. 7.3) — остальные с «Сегодня».
      await nav.getByRole('link', { name: 'Сегодня' }).click();
      const form = page.getByRole('form', { name: 'Быстрое добавление задачи' });
      await form.getByRole('radio', { name: 'Завтра' }).check();
      for (const t of ['Купить подарок', 'Позвонить']) {
        await form.getByLabel('Новая задача').fill(t);
        await form.getByLabel('Новая задача').press('Enter');
        await expect(form.getByLabel('Новая задача')).toHaveValue('');
      }
      await nav.getByRole('link', { name: 'Предстоящие' }).click();
      await expect(page.getByTestId('task')).toHaveCount(3);
      await checkScreen(page, 'Предстоящие с задачами');

      await page.getByRole('button', { name: 'Действия с задачей «Позвонить»' }).click();
      await checkScreen(page, 'меню с «Выше / Ниже»', '.task-menu:has(.menu)');
      await page.keyboard.press('Escape');

      await page.getByLabel('Поиск задач').fill('по');
      await expect(page.getByTestId('search-results')).toBeVisible();
      await checkScreen(page, 'результаты поиска');
      await page.getByLabel('Поиск задач').fill('нет такого');
      await expect(page.locator('.empty-text')).toBeVisible();
      await checkScreen(page, 'поиск без результатов');
      await page.getByLabel('Поиск задач').press('Escape');

      // Выполненная вчера — просмотр.
      await page.getByRole('checkbox', { name: 'Позвонить' }).click();
      await expect(page.getByRole('checkbox', { name: 'Позвонить' })).toHaveCount(0); // ушла с «Предстоящих»
      await page.clock.setSystemTime(new Date('2026-10-10T09:00:00'));
      await page.reload();
      await page.getByLabel('Поиск задач').fill('позвонить');
      await page.getByRole('button', { name: 'Открыть задачу: Позвонить' }).click();
      await expect(page.getByRole('dialog', { name: 'Просмотр задачи' })).toBeVisible();
      await checkScreen(page, 'просмотр задачи');
    });

    test('повторение, выбор «Только эту / Всю серию», метки переноса, конфликт: доступность и вёрстка', async ({ page, context }) => {
      await page.clock.install({ time: new Date('2026-10-09T09:00:00') });
      await createProfile(page);
      // Задача с переносом третий раз подряд.
      const quick = page.getByLabel('Новая задача');
      await quick.fill('Разобрать почту за неделю');
      await quick.press('Enter');
      await expect(page.getByTestId('task')).toHaveCount(1);

      await page.getByRole('button', { name: 'Подробнее…' }).click();
      const d = page.getByRole('dialog', { name: 'Новая задача' });
      await d.getByLabel('Название', { exact: true }).fill('Бассейн');
      await d.getByRole('radio', { name: 'Дата', exact: true }).check();
      await d.getByLabel('Повторение').selectOption({ label: 'По дням недели' });
      await d.getByRole('checkbox', { name: 'пятница' }).uncheck();
      await d.getByRole('button', { name: 'Сохранить' }).click();
      await expect(d.getByText('Выберите хотя бы один день недели')).toBeVisible();
      await checkScreen(page, 'форма: повторение по дням недели с ошибкой');
      await d.getByRole('checkbox', { name: 'понедельник' }).check();
      await d.getByLabel('Повторение').selectOption({ label: 'Каждый месяц' });
      await checkScreen(page, 'форма: каждый месяц');
      await d.getByLabel('Повторение').selectOption({ label: 'Каждый день' });
      await d.getByRole('button', { name: 'Сохранить' }).click();
      await expect(d).toBeHidden();

      for (const day of ['10', '11', '12']) {
        await page.clock.setSystemTime(new Date(`2026-10-${day}T09:00:00`));
        await page.reload();
        await expect(page.getByTestId('progress-caption')).toBeVisible();
      }
      await expect(page.getByText('Переносится 3-й раз')).toBeVisible();
      await checkScreen(page, 'Сегодня с метками переноса и повтора');

      await page.getByRole('button', { name: 'Изменить задачу: Бассейн' }).first().click();
      const form = page.getByRole('dialog', { name: 'Изменить задачу' });
      await form.getByLabel('Название', { exact: true }).fill('Бассейн утром');
      await form.getByRole('button', { name: 'Сохранить' }).click();
      await expect(page.getByRole('dialog', { name: 'Изменить повторяющуюся задачу' })).toBeVisible();
      await checkScreen(page, 'выбор «Только эту / Всю серию»');
      await page.getByRole('dialog', { name: 'Изменить повторяющуюся задачу' }).getByRole('button', { name: 'Отмена' }).click();
      await form.getByRole('button', { name: 'Отмена' }).click();
      await page.getByRole('dialog', { name: 'Закрыть без сохранения?' }).getByRole('button', { name: 'Закрыть без сохранения' }).click();

      const nav = page.getByRole('navigation', { name: 'Основная навигация' });
      await nav.getByRole('link', { name: 'Предстоящие' }).click();
      await expect(page.getByText('Повторяющиеся задачи показаны на 2 недели вперёд')).toBeVisible();
      await checkScreen(page, 'Предстоящие с сериями');

      // Конфликт правок.
      const other = await context.newPage();
      await other.setViewportSize(page.viewportSize()!);
      await other.goto('/');
      await page.getByRole('link', { name: 'Сегодня' }).click();
      await page.getByRole('button', { name: 'Изменить задачу: Разобрать почту за неделю' }).click();
      await page.getByRole('dialog', { name: 'Изменить задачу' }).getByLabel('Заметка').fill('моя');
      await other.getByRole('button', { name: 'Изменить задачу: Разобрать почту за неделю' }).click();
      await other.getByRole('dialog', { name: 'Изменить задачу' }).getByLabel('Заметка').fill('чужая');
      await other.getByRole('dialog', { name: 'Изменить задачу' }).getByRole('button', { name: 'Сохранить' }).click();
      await page.getByRole('dialog', { name: 'Изменить задачу' }).getByRole('button', { name: 'Сохранить' }).click();
      await expect(page.getByRole('dialog', { name: 'Задачу изменили в другой вкладке' })).toBeVisible();
      await checkScreen(page, 'конфликт правок');
    });

    test('отчёты с данными: неделя, месяц, выбранный день — доступность и вёрстка', async ({ page }) => {
      await seedReportCase(page, 'R18');
      await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Отчёты' }).click();
      await expect(page.getByTestId('summary-tasks')).toContainText('67%');
      await checkScreen(page, 'отчёт за неделю');
      await page.getByRole('radio', { name: 'Месяц' }).check();
      await page.getByRole('button', { name: '6 октября: 2 из 5, 40%' }).click();
      await expect(page.getByText(/\(задачи 1 из 4/)).toBeVisible();
      await checkScreen(page, 'отчёт за месяц');
      // Ячейки сетки — не меньше 44 × 44 px (п. 12.2).
      const sizes = await page.locator('.calendar .cell').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()));
      for (const r of sizes) expect(Math.min(r.width, r.height)).toBeGreaterThanOrEqual(43.5);
    });

    test('вечернее уведомление, блок «Завтра», плашка о копии, настройки уведомлений — доступность и вёрстка', async ({ page }) => {
      await page.clock.install({ time: new Date('2026-10-01T19:58:00') });
      await createProfile(page, 'Константин Константинопольский');
      const form = page.getByRole('form', { name: 'Быстрое добавление задачи' });
      await form.getByRole('radio', { name: 'Завтра', exact: true }).check();
      for (const title of ['Позвонить в банк и уточнить условия вклада до конца недели', 'Купить хлеб', 'Йога', 'Отправить отчёт']) {
        await form.getByLabel('Новая задача').fill(title);
        await form.getByLabel('Новая задача').press('Enter');
        await expect(form.getByLabel('Новая задача')).toHaveValue('');
      }
      await page.clock.runFor('03:00');
      await expect(page.getByTestId('reminder')).toBeVisible();
      await page.getByTestId('tomorrow-block').locator('summary').click();
      await checkScreen(page, 'уведомление и блок «Завтра»');

      await page.clock.setSystemTime(new Date('2026-10-20T10:00:00'));
      await page.reload();
      await expect(page.getByTestId('backup-banner')).toBeVisible();
      await checkScreen(page, 'плашка о копии');
      await openSettings(page);
      await expect(page.getByRole('switch', { name: 'Вечернее напоминание о задачах на завтра' })).toBeChecked();
      await checkScreen(page, 'настройки с уведомлениями');
    });

    test('навигация: снизу до 768 px, сбоку от 768 px', async ({ page }) => {
      await createProfile(page);
      const nav = page.getByRole('navigation', { name: 'Основная навигация' });
      const box = await nav.boundingBox();
      const viewport = page.viewportSize()!;
      expect(box).not.toBeNull();
      if (width < 768) {
        expect(box!.y + box!.height).toBeGreaterThan(viewport.height - 40);
        expect(box!.width).toBeGreaterThan(viewport.width - 40);
      } else {
        expect(box!.x).toBeLessThanOrEqual(1);
        expect(box!.width).toBeLessThan(260);
      }
      // Подписи разделов не вылезают за свою ячейку и не рвутся посреди слова (только мягкий перенос).
      const labels = await nav.locator('.nav-link span').evaluateAll((els) =>
        els.map((el) => ({ text: el.textContent, overflow: el.scrollWidth - el.clientWidth, height: el.getBoundingClientRect().height })),
      );
      for (const l of labels) expect(l.overflow, `подпись «${l.text}»`).toBeLessThanOrEqual(0);
      // Не больше двух строк в подписи.
      for (const l of labels) expect(l.height, `подпись «${l.text}»`).toBeLessThanOrEqual(14 * 1.15 * 2 + 1);
      // Последний элемент контента не прячется под нижней панелью.
      await openSettings(page);
      const about = page.getByRole('heading', { name: 'О приложении' });
      await about.scrollIntoViewIfNeeded();
      await expect(about).toBeInViewport();
    });
  });
}

// Масштаб браузера 200% и 400% на ширине 1280 px = CSS-ширина 640 и 320 px (WCAG 1.4.4, 1.4.10; п. 12.3).
for (const width of [640, 320]) {
  test(`масштаб: ширина ${width} CSS px — без горизонтальной прокрутки`, async ({ page }) => {
    await page.setViewportSize({ width, height: 400 });
    await createProfile(page, 'Константин Константинопольский');
    for (const name of ['Сегодня', 'Предстоящие', 'Привычки', 'Отчёты', 'Настройки']) {
      await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name }).click();
      if (name !== 'Сегодня') await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, name).toBeLessThanOrEqual(0);
    }
  });
}

// 400% с данными: отчёты с сеткой месяца и привычками (п. 12.3, критерий 17).
test('масштаб 400% (320 CSS px): отчёты с данными — без горизонтальной прокрутки', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 400 });
  await seedReportCase(page, 'R18');
  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Отчёты' }).click();
  await expect(page.getByTestId('summary-tasks')).toBeVisible();
  for (const kind of ['Неделя', 'Месяц']) {
    await page.getByRole('radio', { name: kind }).check();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, kind).toBeLessThanOrEqual(0);
  }
});
