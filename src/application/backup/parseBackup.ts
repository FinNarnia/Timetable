import { archivedAtFor, sortedVersions } from '../../domain/habits';
import type { DataSet } from '../../domain/types';
import { ENTITY_COLLECTIONS } from '../../domain/types';
import { backupEnvelopeSchema, dataSetSchema } from './schema';

export const MAX_BACKUP_BYTES = 25 * 1024 * 1024; // п. 4.4; 25 МБ — решение от 11.10.2026 (копия объёма п. 15.2 весит ≈ 11 МБ)

export type BackupSummary = {
  exportedAt: string;
  profileName: string;
  tasks: number;
  habits: number;
  habitChecks: number;
};

export type BackupParseError = 'not-a-backup' | 'newer-version' | 'too-large';

export type BackupParseResult =
  | { ok: true; data: DataSet; summary: BackupSummary }
  | { ok: false; error: BackupParseError };

/**
 * Миграции содержимого копии со старых версий схемы: ключ — версия, С которой переводим на +1.
 * Должны повторять миграции IndexedDB (п. 4.4, 14.4). Для версии 1 миграций нет.
 */
export const BACKUP_MIGRATIONS: Record<number, (data: unknown) => unknown> = {};

function migrate(data: unknown, from: number, to: number): unknown {
  let current = data;
  for (let v = from; v < to; v++) {
    const step = BACKUP_MIGRATIONS[v];
    if (!step) throw new Error(`Нет миграции копии с версии ${v}`);
    current = step(current);
  }
  return current;
}

/** Все записи принадлежат профилю из файла, идентификаторы не повторяются. */
function isConsistent(data: DataSet): boolean {
  const userId = data.profile.id;
  if (data.settings.userId !== userId) return false;
  for (const name of ENTITY_COLLECTIONS) {
    const ids = new Set<string>();
    for (const row of data[name]) {
      if (row.userId !== userId || ids.has(row.id)) return false;
      ids.add(row.id);
    }
  }
  return true;
}

export function summarize(data: DataSet, exportedAt: string): BackupSummary {
  const alive = <T extends { deletedAt: string | null }>(rows: T[]) => rows.filter((r) => r.deletedAt === null).length;
  return {
    exportedAt,
    profileName: data.profile.name,
    tasks: alive(data.tasks),
    habits: alive(data.habits),
    habitChecks: alive(data.habitChecks),
  };
}

/** Разбор и полная проверка текста файла копии. Чистая функция: работает и в Web Worker, и в основном потоке. */
export function parseBackupText(text: string, currentSchemaVersion: number): BackupParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'not-a-backup' };
  }
  const envelope = backupEnvelopeSchema.safeParse(json);
  if (!envelope.success) return { ok: false, error: 'not-a-backup' };
  const { schemaVersion, exportedAt } = envelope.data;
  if (schemaVersion > currentSchemaVersion) return { ok: false, error: 'newer-version' };

  let migrated: unknown;
  try {
    migrated = migrate(envelope.data.data, schemaVersion, currentSchemaVersion);
  } catch {
    return { ok: false, error: 'not-a-backup' };
  }
  const parsed = dataSetSchema.safeParse(migrated);
  if (!parsed.success) return { ok: false, error: 'not-a-backup' };
  const data = parsed.data as DataSet;
  if (!isConsistent(data)) return { ok: false, error: 'not-a-backup' };
  recomputeArchivedAt(data);
  return { ok: true, data, summary: summarize(data, exportedAt) };
}

export const BACKUP_ERROR_TEXT: Record<BackupParseError, string> = {
  'not-a-backup': 'Этот файл не похож на резервную копию «Моего ритма».',
  'newer-version': 'Копия сделана в более новой версии приложения. Обновите страницу и попробуйте снова.',
  'too-large': 'Файл больше 25 МБ — это не резервная копия «Моего ритма».',
};

/** archivedAt — производное поле: при импорте пересчитывается по последней версии расписания (п. 13.8). */
function recomputeArchivedAt(data: DataSet): void {
  const byHabit = new Map<string, DataSet['habitSchedules']>();
  for (const s of data.habitSchedules) byHabit.set(s.habitId, [...(byHabit.get(s.habitId) ?? []), s]);
  for (const habit of data.habits) habit.archivedAt = archivedAtFor(sortedVersions(byHabit.get(habit.id) ?? []));
}
