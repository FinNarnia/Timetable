import type { Page } from '@playwright/test';
import { createProfile, expect, openSettings, test } from './fixtures';

/** Группа на экране «Сегодня» по заголовку (к названию добавляется счётчик). */
function group(page: Page, name: string) {
  return page.getByRole('region', { name: new RegExp(`^${name}( \\d+)?$`) });
}

function titles(page: Page, name: string) {
  return group(page, name).getByTestId('task').locator('.task-title span[id]');
}

const caption = (page: Page) => page.getByTestId('progress-caption');
const ring = (page: Page) => page.locator('.ring svg');
const toastRegion = (page: Page) => page.getByRole('status');

async function quickAdd(page: Page, title: string, target: 'Сегодня' | 'Завтра' | 'Без даты' = 'Сегодня') {
  const form = page.getByRole('form', { name: 'Быстрое добавление задачи' });
  await form.getByRole('radio', { name: target, exact: true }).check();
  await form.getByLabel('Новая задача').fill(title);
  await form.getByLabel('Новая задача').press('Enter');
}

async function taskMenu(page: Page, title: string, action: 'Изменить' | 'Дублировать' | 'Удалить') {
  await page.getByRole('button', { name: `Действия с задачей «${title}»` }).click();
  await page.getByRole('button', { name: action, exact: true }).click();
}

test.describe('экран «Сегодня»: задачи', () => {
  test('11.2 быстрое добавление: конец группы, процент, очистка и фокус; «Без даты»; пустое название', async ({ page }) => {
    await createProfile(page);
    await expect(caption(page)).toHaveText('Нет задач на сегодня');
    await expect(ring(page)).toHaveAttribute('aria-label', 'Нет задач на сегодня');

    await quickAdd(page, 'Первая');
    await expect(titles(page, 'Сегодня')).toHaveText(['Первая']);
    await expect(caption(page)).toHaveText('0 из 1 задачи');
    const input = page.getByLabel('Новая задача');
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
    await expect(toastRegion(page)).toContainText('Задача создана');

    await input.fill('Вторая');
    await input.press('Enter');
    await expect(titles(page, 'Сегодня')).toHaveText(['Первая', 'Вторая']);
    await expect(caption(page)).toHaveText('0 из 2 задач');

    await quickAdd(page, 'Когда-нибудь', 'Без даты');
    await expect(titles(page, 'Без даты')).toHaveText(['Когда-нибудь']);
    await expect(caption(page)).toHaveText('0 из 2 задач');

    await quickAdd(page, 'На завтра', 'Завтра');
    await expect(toastRegion(page)).toContainText('Задача создана на завтра');
    await expect(page.getByText('На завтра', { exact: true })).toHaveCount(0);
    await expect(caption(page)).toHaveText('0 из 2 задач');

    // Пустое название — ничего не создаётся.
    await input.fill('   ');
    await input.press('Enter');
    await expect(input).toBeFocused();
    await expect(page.getByTestId('task')).toHaveCount(3);
  });

  test('11.3 расширенная форма: все поля, новая категория, ошибки у полей и фокус', async ({ page }) => {
    await createProfile(page);
    await page.getByRole('button', { name: 'Подробнее…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Новая задача' });
    await expect(dialog).toBeVisible();

    // Пустое название — ошибка, фокус на поле.
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(dialog.getByText('Введите название задачи')).toBeVisible();
    await expect(dialog.getByLabel('Название', { exact: true })).toBeFocused();

    await dialog.getByLabel('Название', { exact: true }).fill('Отчёт');
    await dialog.getByLabel('Заметка').fill('Квартальный, до обеда');
    await dialog.getByRole('radio', { name: 'Дата и время', exact: true }).check();
    // Время не указано — ошибка у поля «Время».
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(dialog.getByText('Укажите время')).toBeVisible();
    await expect(dialog.getByLabel('Время', { exact: true })).toBeFocused();
    await dialog.getByLabel('Время', { exact: true }).fill('23:59');
    await dialog.getByRole('radio', { name: 'Высокий', exact: true }).check();

    // Новая категория прямо из формы, затем дубль названия (ё/е, регистр).
    await dialog.getByLabel('Категория', { exact: true }).selectOption({ label: '+ Новая категория' });
    await dialog.getByLabel('Название категории').fill('Ёлка');
    await dialog.getByRole('button', { name: 'Создать категорию' }).click();
    await expect(dialog.getByLabel('Категория', { exact: true })).toHaveValue(/.+/);
    await expect(dialog.getByLabel('Категория', { exact: true }).locator('option:checked')).toHaveText('Ёлка');
    await dialog.getByLabel('Категория', { exact: true }).selectOption({ label: '+ Новая категория' });
    await dialog.getByLabel('Название категории').fill('ЕЛКА');
    await dialog.getByRole('button', { name: 'Создать категорию' }).click();
    await expect(dialog.getByText('Категория с таким названием уже есть')).toBeVisible();
    await expect(dialog.getByLabel('Название категории')).toBeFocused();
    await dialog.getByRole('group', { name: 'Новая категория' }).getByRole('button', { name: 'Отмена' }).click();
    await dialog.getByLabel('Категория', { exact: true }).selectOption({ label: 'Ёлка' });

    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(dialog).toBeHidden();
    await expect(toastRegion(page)).toContainText('Задача создана');
    const row = group(page, 'Сегодня').getByTestId('task').filter({ hasText: 'Отчёт' });
    await expect(row).toContainText('23:59');
    await expect(row).toContainText('Высокий');
    await expect(row).toContainText('Ёлка');
    await expect(caption(page)).toHaveText('0 из 1 задачи');

    // Всё сохранилось: форма редактирования показывает те же значения.
    await page.reload();
    await page.getByRole('button', { name: 'Изменить задачу: Отчёт' }).click();
    const edit = page.getByRole('dialog', { name: 'Изменить задачу' });
    await expect(edit.getByLabel('Заметка')).toHaveValue('Квартальный, до обеда');
    await expect(edit.getByLabel('Время', { exact: true })).toHaveValue('23:59');
    await expect(edit.getByRole('radio', { name: 'Высокий' })).toBeChecked();
    await expect(edit.getByLabel('Категория', { exact: true }).locator('option:checked')).toHaveText('Ёлка');
  });

  test('11.3 альтернатива: время без даты невозможно — при «Без даты» поля даты и времени скрыты и очищаются', async ({ page }) => {
    await createProfile(page);
    await page.getByRole('button', { name: 'Подробнее…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Новая задача' });
    await dialog.getByLabel('Название', { exact: true }).fill('Без срока');
    await dialog.getByRole('radio', { name: 'Дата и время', exact: true }).check();
    await dialog.getByLabel('Время', { exact: true }).fill('10:00');
    await dialog.getByRole('radio', { name: 'Без даты', exact: true }).check();
    await expect(dialog.locator('input[type="time"]')).toHaveCount(0);
    await expect(dialog.locator('input[type="date"]')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(titles(page, 'Без даты')).toHaveText(['Без срока']);
    await expect(group(page, 'Без даты').getByTestId('task')).not.toContainText('10:00');
  });

  test('форма: закрытие с несохранёнными изменениями требует подтверждения', async ({ page }) => {
    await createProfile(page);
    await quickAdd(page, 'Задача');
    await page.getByRole('button', { name: 'Изменить задачу: Задача' }).click();
    const dialog = page.getByRole('dialog', { name: 'Изменить задачу' });
    // Без изменений — закрывается сразу.
    await dialog.getByRole('button', { name: 'Отмена' }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole('button', { name: 'Изменить задачу: Задача' }).click();
    await dialog.getByLabel('Название', { exact: true }).fill('Другое');
    await page.keyboard.press('Escape');
    const confirm = page.getByRole('dialog', { name: 'Закрыть без сохранения?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Продолжить редактирование' }).click();
    await expect(dialog.getByLabel('Название', { exact: true })).toHaveValue('Другое');
    await dialog.getByRole('button', { name: 'Отмена' }).click();
    await confirm.getByRole('button', { name: 'Закрыть без сохранения' }).click();
    await expect(dialog).toBeHidden();
    await expect(titles(page, 'Сегодня')).toHaveText(['Задача']);

    // Сохранение изменений.
    await page.getByRole('button', { name: 'Изменить задачу: Задача' }).click();
    await dialog.getByLabel('Название', { exact: true }).fill('Переименована');
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(toastRegion(page)).toContainText('Изменения сохранены');
    await expect(titles(page, 'Сегодня')).toHaveText(['Переименована']);
  });

  test('11.4 выполнение: зачёркивание, «Выполнено сегодня», процент, возврат на место; 100%', async ({ page }) => {
    await createProfile(page);
    for (const t of ['A', 'B', 'C']) await quickAdd(page, t);
    await quickAdd(page, 'Без даты', 'Без даты');
    await expect(caption(page)).toHaveText('0 из 3 задач');

    await page.getByRole('checkbox', { name: 'B' }).click();
    await expect(titles(page, 'Сегодня')).toHaveText(['A', 'C']);
    await expect(titles(page, 'Выполнено сегодня')).toHaveText(['B']);
    await expect(caption(page)).toHaveText('1 из 3 задач');
    await expect(ring(page)).toHaveAttribute('aria-label', 'Выполнено 1 из 3 задач, 33%');
    const done = group(page, 'Выполнено сегодня').locator('.task-title');
    await expect(done).toHaveCSS('text-decoration-line', 'line-through');

    // Повторное нажатие возвращает задачу на прежнее место.
    await page.getByRole('checkbox', { name: 'B' }).click();
    await expect(titles(page, 'Сегодня')).toHaveText(['A', 'B', 'C']);
    await expect(group(page, 'Выполнено сегодня')).toHaveCount(0);
    await expect(caption(page)).toHaveText('0 из 3 задач');

    // Задача без даты в процент не входит (п. 7.2), но после выполнения видна в «Выполнено сегодня».
    await page.getByRole('checkbox', { name: 'Без даты' }).click();
    await expect(titles(page, 'Выполнено сегодня')).toHaveText(['Без даты']);
    await expect(caption(page)).toHaveText('0 из 3 задач');
    await page.getByRole('checkbox', { name: 'Без даты' }).click();
    await expect(titles(page, 'Без даты')).toHaveText(['Без даты']);

    for (const t of ['A', 'B', 'C']) await page.getByRole('checkbox', { name: t }).click();
    await expect(caption(page)).toHaveText('Все задачи на сегодня выполнены');
    await expect(ring(page)).toHaveAttribute('aria-label', 'Выполнено 3 из 3 задач, 100%');
    await expect(page.locator('.ring-label')).toHaveText('100%');
    await expect(group(page, 'Сегодня')).toContainText('На сегодня задач нет');

    // Данные на месте после перезагрузки.
    await page.reload();
    await expect(caption(page)).toHaveText('Все задачи на сегодня выполнены');
    await expect(titles(page, 'Выполнено сегодня')).toHaveCount(3);
    await expect(titles(page, 'Без даты')).toHaveText(['Без даты']);
  });

  test('11.6 дублирование: копия сразу после оригинала, «Копия создана», процент', async ({ page }) => {
    await createProfile(page);
    await quickAdd(page, 'A');
    await quickAdd(page, 'B');
    await taskMenu(page, 'A', 'Дублировать');
    await expect(toastRegion(page)).toContainText('Копия создана');
    await expect(titles(page, 'Сегодня')).toHaveText(['A', 'A', 'B']);
    await expect(caption(page)).toHaveText('0 из 3 задач');
    await expect(page.getByRole('button', { name: 'Действия с задачей «A»' }).first()).toBeFocused();
    await page.reload();
    await expect(titles(page, 'Сегодня')).toHaveText(['A', 'A', 'B']);
  });

  test('11.7 удаление: исчезает, процент, 5 секунд «Отменить», возврат на место', async ({ page }) => {
    await createProfile(page);
    for (const t of ['A', 'B', 'C']) await quickAdd(page, t);
    await page.getByRole('checkbox', { name: 'A' }).click();
    await expect(caption(page)).toHaveText('1 из 3 задач');

    await taskMenu(page, 'B', 'Удалить');
    await expect(titles(page, 'Сегодня')).toHaveText(['C']);
    await expect(caption(page)).toHaveText('1 из 2 задач');
    const undo = toastRegion(page).getByRole('button', { name: 'Отменить' });
    await expect(toastRegion(page)).toContainText('Задача удалена');
    await undo.click();
    await expect(titles(page, 'Сегодня')).toHaveText(['B', 'C']);
    await expect(caption(page)).toHaveText('1 из 3 задач');

    // Без отмены: сообщение исчезает примерно через 5 секунд, удаление сохраняется.
    await taskMenu(page, 'C', 'Удалить');
    await expect(toastRegion(page).getByText('Задача удалена')).toBeVisible();
    await page.mouse.move(0, 0);
    const started = Date.now();
    await expect(toastRegion(page).getByText('Задача удалена')).toBeHidden({ timeout: 8000 });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThan(3500);
    await page.reload();
    await expect(titles(page, 'Сегодня')).toHaveText(['B']);
    await expect(caption(page)).toHaveText('1 из 2 задач');
  });

  test('«Время прошло» у активной задачи со временем', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-09T10:00:00') });
    await createProfile(page);
    await page.getByRole('button', { name: 'Подробнее…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Новая задача' });
    await dialog.getByLabel('Название', { exact: true }).fill('Созвон');
    await dialog.getByRole('radio', { name: 'Дата и время', exact: true }).check();
    await dialog.getByLabel('Время', { exact: true }).fill('10:30');
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    const row = page.getByTestId('task').filter({ hasText: 'Созвон' });
    await expect(row).toContainText('10:30');
    await expect(row).not.toContainText('Время прошло');
    await page.clock.runFor('31:00');
    await expect(row).toContainText('Время прошло');
    // После выполнения метка не показывается.
    await page.getByRole('checkbox', { name: 'Созвон' }).click();
    await expect(page.getByTestId('task').filter({ hasText: 'Созвон' })).not.toContainText('Время прошло');
  });

  test('только клавиатура: добавить → выполнить', async ({ page }) => {
    await createProfile(page);
    const input = page.getByLabel('Новая задача');
    await expect(input).toBeVisible();
    // Доходим до поля быстрого добавления табуляцией.
    for (let i = 0; i < 30 && !(await input.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
    await expect(input).toBeFocused();
    await page.keyboard.type('С клавиатуры');
    await page.keyboard.press('Enter');
    await expect(titles(page, 'Сегодня')).toHaveText(['С клавиатуры']);
    const checkbox = page.getByRole('checkbox', { name: 'С клавиатуры' });
    for (let i = 0; i < 30 && !(await checkbox.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
    await expect(checkbox).toBeFocused();
    await page.keyboard.press('Space');
    await expect(titles(page, 'Выполнено сегодня')).toHaveText(['С клавиатуры']);
    await expect(caption(page)).toHaveText('Все задачи на сегодня выполнены');

    // Меню задачи с клавиатуры: открыть, Esc, фокус вернулся.
    const menu = page.getByRole('button', { name: 'Действия с задачей «С клавиатуры»' });
    await menu.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Изменить', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeFocused();
  });
});

test.describe('категории в настройках', () => {
  test('создать, переименовать, сменить цвет, удалить с подтверждением — задачи остаются без категории', async ({ page }) => {
    await createProfile(page);
    await openSettings(page);
    const block = page.getByRole('region', { name: 'Категории' });
    await block.getByRole('button', { name: 'Новая категория' }).click();
    let dialog = page.getByRole('dialog', { name: 'Новая категория' });
    await dialog.getByLabel('Название', { exact: true }).fill('Работа');
    await dialog.getByRole('radio', { name: 'Синий' }).check();
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(block).toContainText('Работа');
    await expect(block).toContainText('0 задач');

    // Дубль — ошибка у поля.
    await block.getByRole('button', { name: 'Новая категория' }).click();
    dialog = page.getByRole('dialog', { name: 'Новая категория' });
    await dialog.getByLabel('Название', { exact: true }).fill(' работа ');
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(dialog.getByText('Категория с таким названием уже есть')).toBeVisible();
    await dialog.getByRole('button', { name: 'Отмена' }).click();

    // Задача с категорией.
    await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Сегодня' }).click();
    await page.getByRole('button', { name: 'Подробнее…' }).click();
    const form = page.getByRole('dialog', { name: 'Новая задача' });
    await form.getByLabel('Название', { exact: true }).fill('Отчёт');
    await form.getByLabel('Категория', { exact: true }).selectOption({ label: 'Работа' });
    await form.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByTestId('task').filter({ hasText: 'Отчёт' })).toContainText('Работа');

    await openSettings(page);
    await expect(block).toContainText('1 задача');
    await block.getByRole('button', { name: 'Изменить категорию «Работа»' }).click();
    dialog = page.getByRole('dialog', { name: 'Изменить категорию' });
    await dialog.getByLabel('Название', { exact: true }).fill('Офис');
    await dialog.getByRole('radio', { name: 'Зелёный' }).check();
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(block).toContainText('Офис');
    await expect(block.locator('.cat-dot')).toHaveClass(/cat-green/);

    await block.getByRole('button', { name: 'Удалить категорию «Офис»' }).click();
    const confirm = page.getByRole('dialog', { name: 'Удалить категорию?' });
    await expect(confirm).toContainText('1 задача останется, но без категории.');
    await confirm.getByRole('button', { name: 'Отмена' }).click();
    await expect(block).toContainText('Офис');
    await block.getByRole('button', { name: 'Удалить категорию «Офис»' }).click();
    await confirm.getByRole('button', { name: 'Удалить категорию' }).click();
    await expect(block).not.toContainText('Офис');

    await page.reload();
    await expect(page.getByRole('region', { name: 'Категории' })).toContainText('Категорий пока нет');
    await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Сегодня' }).click();
    const row = page.getByTestId('task').filter({ hasText: 'Отчёт' });
    await expect(row).toBeVisible();
    await expect(row).not.toContainText('Офис');
  });
});
