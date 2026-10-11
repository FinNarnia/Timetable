import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/application/services';
import type { Category } from '../../src/domain/types';
import { makeEnv } from '../helpers';

async function readyEnv() {
  const env = makeEnv();
  await env.services.profile.start();
  const profile = await env.services.profile.create('Анна');
  return { ...env, profile };
}

const category = { name: 'Работа', normalizedName: 'работа', color: 'blue' as const };

describe('первый запуск (п. 4.1)', () => {
  it('без профиля start() возвращает undefined', async () => {
    const env = makeEnv();
    await expect(env.services.profile.start()).resolves.toBeUndefined();
  });

  it('создаёт профиль, настройки и скрытый личный календарь', async () => {
    const { deps, profile } = await readyEnv();
    expect(profile.name).toBe('Анна');
    const settings = await deps.repos.settings.get();
    expect(settings).toMatchObject({ userId: profile.id, eveningReminderEnabled: true, eveningReminderTime: '20:00' });
    const calendars = await deps.repos.calendars.list();
    expect(calendars).toHaveLength(1);
    expect(calendars[0]).toMatchObject({ kind: 'personal', name: 'Личный', userId: profile.id });
  });

  it('профиль переживает «перезагрузку» — новое подключение к той же базе', async () => {
    const { dbName, profile, deps } = await readyEnv();
    deps.db.close();
    const again = makeEnv(dbName);
    await expect(again.services.profile.start()).resolves.toEqual(profile);
    expect(again.deps.identity.currentUserId()).toBe(profile.id);
  });

  it('неверное имя не создаёт ничего', async () => {
    const env = makeEnv();
    await env.services.profile.start();
    await expect(env.services.profile.create(' А ')).rejects.toBeInstanceOf(ValidationError);
    expect(await env.deps.repos.profile.get()).toBeUndefined();
    expect(env.deps.identity.currentUserId()).toBeUndefined();
  });

  it('база новее приложения (открыта старая вкладка): ошибка newer-version (п. 12.1)', async () => {
    const { dbName, deps } = await readyEnv();
    deps.db.close();
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(dbName, 9999);
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
    const old = makeEnv(dbName);
    await expect(old.services.profile.start()).rejects.toMatchObject({ name: 'StorageError', kind: 'newer-version' });
  });

  it('переименование профиля', async () => {
    const { services, clock } = await readyEnv();
    clock.advance(60_000);
    const renamed = await services.profile.rename('  Анна Петровна ');
    expect(renamed.name).toBe('Анна Петровна');
    expect(renamed.updatedAt).toBe(clock.nowIso());
  });
});

describe('базовый репозиторий (п. 13.1, 14.3)', () => {
  it('create подставляет id, userId, rev = 1, даты и deletedAt = null', async () => {
    const { deps, profile, clock } = await readyEnv();
    const row = await deps.repos.categories.create(category);
    expect(row).toMatchObject({
      ...category,
      userId: profile.id,
      rev: 1,
      createdAt: clock.nowIso(),
      updatedAt: clock.nowIso(),
      deletedAt: null,
    });
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('update увеличивает rev и updatedAt и не даёт подменить системные поля', async () => {
    const { deps, clock } = await readyEnv();
    const row = await deps.repos.categories.create(category);
    clock.advance(1000);
    const next = await deps.repos.categories.update(row.id, {
      name: 'Дом',
      ...({ userId: 'hacker', rev: 99, createdAt: 'x' } as Partial<Category>),
    });
    expect(next.rev).toBe(2);
    expect(next.updatedAt).toBe(clock.nowIso());
    expect(next.createdAt).toBe(row.createdAt);
    expect(next.userId).toBe(row.userId);
    expect(next.name).toBe('Дом');
    const third = await deps.repos.categories.update(row.id, { color: 'teal' });
    expect(third.rev).toBe(3);
  });

  it('мягкое удаление скрывает запись, includeDeleted показывает, restore возвращает', async () => {
    const { deps } = await readyEnv();
    const a = await deps.repos.categories.create(category);
    const b = await deps.repos.categories.create({ ...category, name: 'Дом', normalizedName: 'дом' });
    await deps.repos.categories.softDelete(a.id);
    expect((await deps.repos.categories.list()).map((c) => c.id)).toEqual([b.id]);
    expect(await deps.repos.categories.getById(a.id)).toBeUndefined();
    const deleted = await deps.repos.categories.getById(a.id, { includeDeleted: true });
    expect(deleted?.deletedAt).not.toBeNull();
    expect(deleted?.rev).toBe(2);
    expect(await deps.repos.categories.list({ includeDeleted: true })).toHaveLength(2);
    await deps.repos.categories.restore(a.id);
    expect(await deps.repos.categories.list()).toHaveLength(2);
  });

  it('записи другого userId не видны и не изменяются', async () => {
    const { deps } = await readyEnv();
    const mine = await deps.repos.categories.create(category);
    await deps.db.categories.add({ ...mine, id: 'foreign', userId: 'other-user' });
    expect((await deps.repos.categories.list({ includeDeleted: true })).map((c) => c.id)).toEqual([mine.id]);
    expect(await deps.repos.categories.getById('foreign')).toBeUndefined();
    await expect(deps.repos.categories.update('foreign', { name: 'x' })).rejects.toThrow();
    await expect(deps.repos.categories.softDelete('foreign')).rejects.toThrow();
    expect((await deps.db.categories.get('foreign'))?.name).toBe('Работа');
  });

  it('без профиля репозитории отказываются работать', async () => {
    const env = makeEnv();
    await env.services.profile.start();
    await expect(env.deps.repos.categories.list()).rejects.toThrow('Профиль ещё не создан');
  });

  it('UnitOfWork откатывает всё при ошибке внутри транзакции', async () => {
    const { deps } = await readyEnv();
    await expect(
      deps.uow.run(async () => {
        await deps.repos.categories.create(category);
        throw new Error('сбой');
      }),
    ).rejects.toThrow('сбой');
    expect(await deps.repos.categories.list()).toHaveLength(0);
  });

  it('уникальный индекс [habitId+date] у отметок привычек (п. 13.10)', async () => {
    const { deps } = await readyEnv();
    await deps.repos.habitChecks.create({ habitId: 'h1', date: '2026-10-09' });
    await expect(deps.repos.habitChecks.create({ habitId: 'h1', date: '2026-10-09' })).rejects.toThrow();
  });
});
