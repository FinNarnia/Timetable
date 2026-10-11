import { createProfile, expect, openSettings, test } from './fixtures';

test.describe('11.1 Первый запуск', () => {
  test('создание профиля, перезагрузка, навигация по разделам', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Данные хранятся только в этом браузере на этом устройстве')).toBeVisible();

    // Альтернатива: имя короче 2 символов — ошибка у поля, профиль не создаётся.
    await page.getByLabel('Как вас зовут?').fill(' А ');
    await page.getByRole('button', { name: 'Начать' }).click();
    await expect(page.getByText('Имя должно быть не короче 2 символов')).toBeVisible();
    await expect(page.getByLabel('Как вас зовут?')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByLabel('Как вас зовут?')).toBeFocused();

    await page.getByLabel('Как вас зовут?').fill('  Анна ');
    await page.getByRole('button', { name: 'Начать' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /, Анна$/ })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Нет задач на сегодня' })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: /, Анна$/ })).toBeVisible();

    const nav = page.getByRole('navigation', { name: 'Основная навигация' });
    for (const [link, heading] of [
      ['Предстоящие', 'Предстоящие'],
      ['Привычки', 'Привычки'],
      ['Отчёты', 'Отчёты'],
      ['Настройки', 'Настройки'],
    ] as const) {
      await nav.getByRole('link', { name: link }).click();
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(nav.getByRole('link', { name: link })).toHaveAttribute('aria-current', 'page');
    }
    // Прямая ссылка на раздел после перезагрузки (SPA-маршрут).
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Настройки' })).toBeVisible();
    await nav.getByRole('link', { name: 'Сегодня' }).click();
    await expect(page.getByText('На сегодня задач нет. Добавьте первую или насладитесь свободным днём.')).toBeVisible();
  });

  test('первый запуск только с клавиатуры', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByLabel('Как вас зовут?')).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Как вас зовут?')).toBeFocused();
    await page.keyboard.type('Оля');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: /, Оля$/ })).toBeVisible();
  });

  test('переименование профиля в настройках', async ({ page }) => {
    await createProfile(page);
    await openSettings(page);
    const name = page.getByLabel('Имя', { exact: true });
    await name.fill('Анна Петровна');
    await page.getByRole('button', { name: 'Сохранить имя' }).click();
    await expect(page.getByRole('status')).toContainText('Имя сохранено');
    await page.reload();
    await page.getByRole('link', { name: 'Сегодня' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /, Анна Петровна$/ })).toBeVisible();
  });

  test('неизвестный адрес ведёт на «Сегодня»', async ({ page }) => {
    await createProfile(page);
    await page.goto('/no-such-page');
    await expect(page.getByRole('heading', { level: 1, name: /, Анна$/ })).toBeVisible();
  });
});
