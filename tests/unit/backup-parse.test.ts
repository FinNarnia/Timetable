import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BackupParser, ParseCancelledError } from '../../src/application/backup/BackupParser';
import { MAX_BACKUP_BYTES, parseBackupText } from '../../src/application/backup/parseBackup';
import { classifyStorageError } from '../../src/infrastructure/storageErrors';

const sample = readFileSync(resolve(process.cwd(), 'fixtures/backups/sample.json'), 'utf8');
const clone = () => JSON.parse(sample);

describe('проверка файла резервной копии (п. 4.4)', () => {
  it('принимает корректную копию и считает сводку без удалённых записей', () => {
    const file = clone();
    file.data.tasks[0].deletedAt = '2026-10-01T00:00:00.000Z';
    const result = parseBackupText(JSON.stringify(file), 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toEqual({
      exportedAt: file.exportedAt,
      profileName: 'Мария',
      tasks: 11,
      habits: 3,
      habitChecks: 30,
    });
    // Удалённая запись сохраняется в данных копии.
    expect(result.data.tasks).toHaveLength(12);
  });

  it.each([
    ['не JSON', 'это не json'],
    ['пустой объект', '{}'],
    ['чужой формат', JSON.stringify({ format: 'other-app', schemaVersion: 1 })],
    ['массив', '[]'],
  ])('отклоняет: %s', (_, text) => {
    expect(parseBackupText(text, 1)).toEqual({ ok: false, error: 'not-a-backup' });
  });

  it('отклоняет копию из более новой версии схемы', () => {
    const file = clone();
    file.schemaVersion = 2;
    expect(parseBackupText(JSON.stringify(file), 1)).toEqual({ ok: false, error: 'newer-version' });
  });

  it('отклоняет повреждённые поля', () => {
    const file = clone();
    file.data.tasks[0].plannedDate = '09.10.2026';
    expect(parseBackupText(JSON.stringify(file), 1).ok).toBe(false);
  });

  it('отклоняет записи чужого профиля и повторяющиеся id', () => {
    const a = clone();
    a.data.habits[0].userId = 'someone-else';
    expect(parseBackupText(JSON.stringify(a), 1).ok).toBe(false);
    const b = clone();
    b.data.tasks[1].id = b.data.tasks[0].id;
    expect(parseBackupText(JSON.stringify(b), 1).ok).toBe(false);
  });

  it('отбрасывает лишние поля (п. 15.1)', () => {
    const file = clone();
    file.data.tasks[0].evil = '<script>';
    file.data.profile.extra = 1;
    const result = parseBackupText(JSON.stringify(file), 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect('evil' in result.data.tasks[0]!).toBe(false);
    expect('extra' in result.data.profile).toBe(false);
  });

  it('файл больше 25 МБ отклоняется без чтения содержимого', async () => {
    expect(MAX_BACKUP_BYTES).toBe(25 * 1024 * 1024);
    const parser = new BackupParser(1);
    const big = { size: MAX_BACKUP_BYTES + 1, text: () => Promise.reject(new Error('не должен читаться')) } as unknown as Blob;
    await expect(parser.parse(big)).resolves.toEqual({ ok: false, error: 'too-large' });
  });

  it('без Web Worker проверяет в основном потоке', async () => {
    const parser = new BackupParser(1);
    const result = await parser.parse(new Blob([sample]));
    expect(result.ok).toBe(true);
  });

  it('отмена до завершения проверки не возвращает результат', async () => {
    const parser = new BackupParser(1);
    const controller = new AbortController();
    controller.abort();
    await expect(parser.parse(new Blob([sample]), controller.signal)).rejects.toBeInstanceOf(ParseCancelledError);
  });
});

describe('классификация ошибок хранилища (п. 12.1)', () => {
  const err = (name: string, inner?: unknown) => Object.assign(new Error(name), { name, inner });
  it.each([
    [err('QuotaExceededError'), 'quota'],
    [err('AbortError', err('QuotaExceededError')), 'quota'],
    [err('OpenFailedError', err('VersionError')), 'newer-version'],
    [err('UpgradeError'), 'migration'],
    [err('MissingAPIError'), 'unavailable'],
    [err('OpenFailedError', err('InvalidStateError')), 'unavailable'],
    [err('TypeError'), 'unknown'],
    ['строка', 'unknown'],
  ])('%#', (error, kind) => {
    expect(classifyStorageError(error)).toBe(kind);
  });
});

describe('archivedAt при импорте (п. 13.8)', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { parseBackupText } = await import('../../src/application/backup/parseBackup');
  it('пересчитывается по последней версии расписания, а не берётся из файла', () => {
    const backup = JSON.parse(readFileSync(resolve(process.cwd(), 'fixtures/backups/sample.json'), 'utf8'));
    const [h1, h2] = backup.data.habits;
    h1.archivedAt = '2026-01-01'; // неверно: последняя версия активна
    const last = backup.data.habitSchedules.filter((s: { habitId: string }) => s.habitId === h2.id).at(-1);
    backup.data.habitSchedules.push({ ...last, id: '01a12520-2df4-7528-b600-28c2d1229999', effectiveFrom: '2026-10-09', active: false });
    h2.archivedAt = null;
    const result = parseBackupText(JSON.stringify(backup), backup.schemaVersion);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.habits.find((h) => h.id === h1.id)!.archivedAt).toBeNull();
    expect(result.data.habits.find((h) => h.id === h2.id)!.archivedAt).toBe('2026-10-09');
  });
});
