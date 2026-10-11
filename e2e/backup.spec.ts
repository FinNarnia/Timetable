import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chooseBackupFile, createProfile, downloadBackup, expect, openSettings, test } from './fixtures';

const sample = readFileSync(resolve('fixtures/backups/sample.json'));
const withoutExportedAt = (json: Record<string, unknown>) => ({ ...json, exportedAt: undefined });

test.describe('11.17 Резервная копия и восстановление', () => {
  test('копия из одного браузера восстанавливается в чистом контексте и даёт те же данные', async ({ page, browser }) => {
    await createProfile(page, 'Анна');
    await openSettings(page);
    await expect(page.getByTestId('last-export')).toHaveText('ещё не сохранялась');
    const first = await downloadBackup(page);
    expect(first.fileName).toMatch(/^moy-ritm-\d{4}-\d{2}-\d{2}\.json$/);
    expect(first.json.format).toBe('moy-ritm-backup');
    await expect(page.getByTestId('last-export')).not.toHaveText('ещё не сохранялась');

    // Чистый контекст = другой браузер без данных.
    const context = await browser.newContext({ locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
    const other = await context.newPage();
    await other.goto('/');
    await chooseBackupFile(other, 'Восстановить из резервной копии', {
      name: first.fileName,
      buffer: Buffer.from(JSON.stringify(first.json)),
    });
    const dialog = other.getByRole('dialog', { name: 'Восстановить из копии?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Анна')).toBeVisible();
    // На первом запуске заменять нечего — предупреждения нет.
    await expect(dialog.getByText('Текущие данные будут заменены')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Восстановить' }).click();
    await expect(other.getByRole('heading', { level: 1, name: /, Анна$/ })).toBeVisible();
    await expect(other.getByRole('status')).toContainText('Данные восстановлены');

    await openSettings(other);
    const second = await downloadBackup(other);
    // lastExportAt в настройках отличается: в первой копии его ещё не было — сравниваем остальное.
    const strip = (j: typeof first.json) => {
      const data = structuredClone(j.data) as { settings: Record<string, unknown> };
      data.settings.lastExportAt = null;
      data.settings.updatedAt = null;
      return { ...withoutExportedAt(j), data };
    };
    expect(strip(second.json)).toEqual(strip(first.json));
    await context.close();
  });

  test('восстановление поверх существующих данных: сводка, предупреждение, другой профиль', async ({ page }) => {
    await createProfile(page, 'Борис');
    await openSettings(page);
    await chooseBackupFile(page, 'Восстановить из копии', { name: 'sample.json', buffer: sample });
    const dialog = page.getByRole('dialog', { name: 'Восстановить из копии?' });
    await expect(dialog.getByText('Мария')).toBeVisible();
    await expect(dialog.locator('dd').nth(2)).toHaveText('12');
    await expect(dialog.locator('dd').nth(3)).toHaveText('3');
    await expect(dialog.locator('dd').nth(4)).toHaveText('30');
    await expect(dialog.getByText('Текущие данные будут заменены')).toBeVisible();
    await dialog.getByRole('button', { name: 'Восстановить' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /, Мария$/ })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: /, Мария$/ })).toBeVisible();
  });

  test('отмена на сводке ничего не меняет', async ({ page }) => {
    await createProfile(page, 'Борис');
    await openSettings(page);
    await chooseBackupFile(page, 'Восстановить из копии', { name: 'sample.json', buffer: sample });
    const dialog = page.getByRole('dialog', { name: 'Восстановить из копии?' });
    await dialog.getByRole('button', { name: 'Отмена' }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole('link', { name: 'Сегодня' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /, Борис$/ })).toBeVisible();
  });

  test('чужой или повреждённый файл: понятная ошибка, данные на месте', async ({ page }) => {
    await createProfile(page, 'Борис');
    await openSettings(page);
    for (const buffer of [Buffer.from('{"format":"other-app"}'), Buffer.from('не json'), sample.subarray(0, 500)]) {
      await chooseBackupFile(page, 'Восстановить из копии', { name: 'x.json', buffer });
      const dialog = page.getByRole('dialog', { name: 'Не получилось' });
      await expect(dialog.getByRole('alert')).toHaveText('Этот файл не похож на резервную копию «Моего ритма».');
      await dialog.getByRole('button', { name: 'Понятно' }).click();
    }
    await page.reload();
    await page.getByRole('link', { name: 'Сегодня' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /, Борис$/ })).toBeVisible();
  });

  test('прерванный импорт (закрытие вкладки во время записи) не оставляет половину данных', async ({ page, context }) => {
    const dir = mkdtempSync(join(tmpdir(), 'moy-ritm-'));
    const file = join(dir, 'big.json');
    execFileSync('node', ['scripts/seed.mjs', '--tasks', '9000', '--checks', '12000', '--name', 'Большой', '--out', file]);
    await createProfile(page, 'Борис');
    await openSettings(page);
    await chooseBackupFile(page, 'Восстановить из копии', { name: 'big.json', buffer: readFileSync(file) });
    const dialog = page.getByRole('dialog', { name: 'Восстановить из копии?' });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole('button', { name: 'Восстановить' }).click();
    await expect(page.getByText('Восстанавливаем данные…')).toBeVisible();
    await page.close({ runBeforeUnload: false });

    const again = await context.newPage();
    await again.goto('/settings');
    const backup = await downloadBackup(again);
    const data = backup.json.data as { profile: { name: string }; tasks: unknown[]; habitChecks: unknown[] };
    // Либо полностью старые данные, либо полностью новые — никогда не смесь.
    if (data.profile.name === 'Борис') {
      expect(data.tasks).toHaveLength(0);
      expect(data.habitChecks).toHaveLength(0);
    } else {
      expect(data.profile.name).toBe('Большой');
      expect(data.tasks).toHaveLength(9000);
      expect(data.habitChecks).toHaveLength(12000);
    }
  });

  test('удаление всех данных: предложение копии, слово УДАЛИТЬ, возврат к первому запуску', async ({ page }) => {
    await createProfile(page, 'Борис');
    await openSettings(page);
    await page.getByRole('button', { name: 'Удалить все данные' }).click();
    const dialog = page.getByRole('dialog', { name: 'Удалить все данные?' });
    await expect(dialog.getByRole('button', { name: 'Скачать резервную копию' })).toBeVisible();
    const confirm = dialog.getByRole('button', { name: 'Удалить всё' });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('Введите слово УДАЛИТЬ').fill('удалить');
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('Введите слово УДАЛИТЬ').fill('УДАЛИТЬ');
    await confirm.click();
    await expect(page.getByLabel('Как вас зовут?')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Как вас зовут?')).toBeVisible();
  });

  test('Esc закрывает диалог и возвращает фокус на кнопку', async ({ page }) => {
    await createProfile(page);
    await openSettings(page);
    const opener = page.getByRole('button', { name: 'Удалить все данные' });
    await opener.click();
    await expect(page.getByRole('dialog', { name: 'Удалить все данные?' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
});
