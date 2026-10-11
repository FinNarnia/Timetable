import { createProfile, expect, test } from './fixtures';

test.describe('п. 12.1 Ошибки хранилища', () => {
  test('IndexedDB недоступна: понятное сообщение без технических деталей', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true });
    });
    await page.goto('/');
    const alert = page.getByRole('alert');
    await expect(alert.getByRole('heading', { name: 'Браузер не разрешает сохранять данные' })).toBeVisible();
    await expect(alert).toContainText('Откройте приложение в обычном окне');
    await expect(alert).not.toContainText(/IndexedDB|Error|Dexie/);
  });

  test('схему обновили в другой вкладке: просьба обновить страницу', async ({ page }) => {
    await createProfile(page);
    // Имитация новой версии приложения: другая «вкладка» открывает базу с большей версией.
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const req = indexedDB.open('moy-ritm', 9999);
          req.onsuccess = () => {
            req.result.close();
            resolve();
          };
          req.onerror = () => reject(req.error);
        }),
    );
    await expect(page.getByRole('heading', { name: 'Вышла новая версия' })).toBeVisible();
    // После перезагрузки старая версия приложения не может открыть более новую базу.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Вышла новая версия' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Обновить страницу' })).toBeVisible();
  });
});
