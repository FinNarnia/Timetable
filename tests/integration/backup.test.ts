import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import type { DataSet } from '../../src/domain/types';
import { SCHEMA_VERSION } from '../../src/infrastructure/db';
import { makeEnv } from '../helpers';

const sampleText = readFileSync(resolve(process.cwd(), 'fixtures/backups/sample.json'), 'utf8');

async function envWithData(name = 'Анна') {
  const env = makeEnv();
  await env.services.profile.start();
  await env.services.profile.create(name);
  const { repos } = env.deps;
  const work = await repos.categories.create({ name: 'Работа', normalizedName: 'работа', color: 'blue' });
  const removed = await repos.categories.create({ name: 'Старое', normalizedName: 'старое', color: 'rose' });
  await repos.categories.softDelete(removed.id);
  const [calendar] = await repos.calendars.list();
  await repos.tasks.create({
    calendarId: calendar!.id,
    title: 'Подготовить отчёт',
    note: 'Заметка\nв две строки',
    status: 'active',
    priority: 'high',
    categoryId: work.id,
    scheduleType: 'datetime',
    plannedDate: '2026-10-09',
    plannedTime: '14:00',
    seriesId: null,
    occurrenceDate: null,
    isException: false,
    sortOrder: 'a0',
    autoMoveCount: 0,
    completedAt: null,
  });
  const habit = await repos.habits.create({ title: 'Зарядка', sortOrder: 'a0', archivedAt: null });
  await repos.habitSchedules.create({
    habitId: habit.id,
    effectiveFrom: '2026-10-01',
    active: true,
    type: 'weekdays',
    weekdays: [1, 3, 5],
    weeklyTarget: null,
  });
  await repos.habitChecks.create({ habitId: habit.id, date: '2026-10-09' });
  return env;
}

async function roundTrip(text: string, env: ReturnType<typeof makeEnv>) {
  const result = await env.services.data.checkBackup(new Blob([text]));
  if (!result.ok) throw new Error(result.error);
  await env.services.data.importBackup(result.data);
  return result;
}

const withoutExportedAt = (text: string) => {
  const parsed = JSON.parse(text);
  delete parsed.exportedAt;
  return parsed;
};

describe('резервная копия (п. 4.3–4.4)', () => {
  it('экспорт содержит служебные поля, версию схемы и мягко удалённые записи', async () => {
    const env = await envWithData();
    const { fileName, content } = await env.services.data.exportBackup();
    expect(fileName).toBe('moy-ritm-2026-10-09.json');
    const file = JSON.parse(content);
    expect(file).toMatchObject({ format: 'moy-ritm-backup', schemaVersion: SCHEMA_VERSION, appVersion: 'test' });
    expect(file.exportedAt).toBe(env.clock.nowIso());
    expect(file.data.categories).toHaveLength(2);
    expect(file.data.categories.some((c: { deletedAt: string | null }) => c.deletedAt !== null)).toBe(true);
  });

  it('экспорт → импорт в чистую базу → экспорт даёт те же данные (кроме exportedAt)', async () => {
    const source = await envWithData();
    const first = await source.services.data.exportBackup();

    const target = makeEnv();
    await target.services.profile.start();
    await roundTrip(first.content, target);
    target.clock.advance(3_600_000);
    const second = await target.services.data.exportBackup();
    expect(withoutExportedAt(second.content)).toEqual(withoutExportedAt(first.content));
  });

  it('копия с другим userId принимается: текущим становится профиль из файла', async () => {
    const env = await envWithData('Борис');
    const ownId = env.deps.identity.currentUserId();
    const result = await roundTrip(sampleText, env);
    expect(result.data.profile.id).not.toBe(ownId);
    expect(env.deps.identity.currentUserId()).toBe(result.data.profile.id);
    expect((await env.deps.repos.profile.get())?.name).toBe('Мария');
    expect(await env.deps.repos.tasks.list()).toHaveLength(12);
    // Данные старого профиля полностью заменены.
    expect(await env.deps.db.tasks.where('userId').equals(ownId!).count()).toBe(0);
  });

  it('повреждённый или чужой файл не меняет базу', async () => {
    const env = await envWithData();
    const before = (await env.services.data.exportBackup()).content;
    for (const text of ['мусор', '{"format":"other"}', sampleText.replace('"Мария"', '42')]) {
      const result = await env.services.data.checkBackup(new Blob([text]));
      expect(result.ok).toBe(false);
    }
    expect((await env.services.data.exportBackup()).content).toBe(before);
  });

  it('сбой записи посреди импорта откатывает всё: прежние данные на месте', async () => {
    const env = await envWithData();
    const before = (await env.services.data.exportBackup()).content;
    const broken = JSON.parse(sampleText).data as DataSet;
    // Две отметки на один день нарушают уникальный индекс [habitId+date] — запись упадёт на последнем шаге.
    broken.habitChecks.push({ ...broken.habitChecks[0]!, id: 'duplicate-check' });
    await expect(env.services.data.importBackup(broken)).rejects.toThrow();
    expect((await env.services.data.exportBackup()).content).toBe(before);
  });

  it('отметка о скачанной копии сохраняется в настройках', async () => {
    const env = await envWithData();
    await env.services.data.markExported();
    expect((await env.services.data.currentSettings())?.lastExportAt).toBe(env.clock.nowIso());
  });

  it('удаление всех данных очищает базу и сбрасывает профиль', async () => {
    const env = await envWithData();
    await env.services.data.deleteAllData();
    expect(await env.deps.repos.profile.get()).toBeUndefined();
    expect(env.deps.identity.currentUserId()).toBeUndefined();
    for (const table of env.deps.db.tables) expect(await table.count()).toBe(0);
  });

  it('аварийная выгрузка читает базу «как есть»', async () => {
    const env = await envWithData();
    const raw = JSON.parse((await env.services.data.exportRaw()).content);
    expect(Object.keys(raw).sort()).toEqual(env.deps.db.tables.map((t) => t.name).sort());
    expect(raw.tasks).toHaveLength(1);
  });
});

describe('миграции IndexedDB на снимках схемы (п. 14.4)', () => {
  const snapshots = [
    JSON.parse(readFileSync(resolve(process.cwd(), 'fixtures/migrations/v1.json'), 'utf8')) as {
      version: number;
      stores: Record<string, string>;
      data: Record<string, unknown[]>;
    },
  ];

  it.each(snapshots.map((s) => [s.version, s] as const))('база версии %i открывается без потери данных', async (_, snapshot) => {
    const name = `migration-${snapshot.version}-${Math.random()}`;
    const old = new Dexie(name);
    old.version(snapshot.version).stores(snapshot.stores);
    await old.open();
    for (const [table, rows] of Object.entries(snapshot.data)) await old.table(table).bulkAdd(rows);
    old.close();

    const env = makeEnv(name);
    const profile = await env.services.profile.start();
    expect(profile?.name).toBe('Снимок');
    for (const [table, rows] of Object.entries(snapshot.data)) {
      expect(await env.deps.db.table(table).count()).toBe(rows.length);
    }
    const exported = JSON.parse((await env.services.data.exportBackup()).content);
    expect(exported.schemaVersion).toBe(SCHEMA_VERSION);
  });
});
