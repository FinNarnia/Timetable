import { describe, expect, it } from 'vitest';
import { compareInDay, draftFromTask, emptyDraft, SORT_KEY_MAX } from '../../src/domain/tasks';
import { makeEnv } from '../helpers';

async function readyEnv() {
  const env = makeEnv();
  await env.services.profile.start();
  await env.services.profile.create('Анна');
  return env;
}

const TODAY = '2026-10-09';

async function order(env: Awaited<ReturnType<typeof readyEnv>>, date: string | null) {
  const list = await env.services.tasks.list();
  return list
    .filter((t) => t.status === 'active' && t.plannedDate === date)
    .sort(compareInDay)
    .map((t) => t.title);
}

describe('ручная сортировка (п. 6.13)', () => {
  it('«Выше» и «Ниже» меняют местами ключи и сохраняются после переподключения', async () => {
    const env = await readyEnv();
    const { services } = env;
    const a = await services.tasks.quickAdd('A', 'today');
    const b = await services.tasks.quickAdd('B', 'today');
    const c = await services.tasks.quickAdd('C', 'today');
    await expect(services.tasks.move(c.id, 'up')).resolves.toEqual({ position: 2, total: 3 });
    expect(await order(env, TODAY)).toEqual(['A', 'C', 'B']);
    await expect(services.tasks.move(a.id, 'down')).resolves.toEqual({ position: 2, total: 3 });
    expect(await order(env, TODAY)).toEqual(['C', 'A', 'B']);

    // Ключи не растут: те же три значения, только переставлены.
    const keys = (await services.tasks.list()).map((t) => t.sortOrder).sort();
    expect(keys).toEqual([a.sortOrder, b.sortOrder, c.sortOrder].sort());

    env.deps.db.close();
    const again = makeEnv(env.dbName);
    await again.services.profile.start();
    const list = (await again.services.tasks.list()).sort(compareInDay).map((t) => t.title);
    expect(list).toEqual(['C', 'A', 'B']);
  });

  it('на краю и для задачи со временем — null, ничего не меняется', async () => {
    const env = await readyEnv();
    const { services } = env;
    const a = await services.tasks.quickAdd('A', 'today');
    await services.tasks.quickAdd('B', 'today');
    const timed = await services.tasks.create(
      emptyDraft({ title: '10:00', scheduleType: 'datetime', plannedDate: TODAY, plannedTime: '10:00' }),
    );
    await expect(services.tasks.move(a.id, 'up')).resolves.toBeNull();
    await expect(services.tasks.move(timed.id, 'down')).resolves.toBeNull();
    expect(await order(env, TODAY)).toEqual(['10:00', 'A', 'B']);
  });

  it('группа «Без даты» сортируется отдельно', async () => {
    const env = await readyEnv();
    const { services } = env;
    await services.tasks.quickAdd('сегодня', 'today');
    await services.tasks.quickAdd('N1', 'none');
    const n2 = await services.tasks.quickAdd('N2', 'none');
    await expect(services.tasks.move(n2.id, 'up')).resolves.toEqual({ position: 1, total: 2 });
    expect(await order(env, null)).toEqual(['N2', 'N1']);
  });

  it('автоперенесённые двигаются только среди автоперенесённых', async () => {
    const env = await readyEnv();
    const { services, deps } = env;
    const m = await services.tasks.quickAdd('ручная', 'today');
    const a1 = await services.tasks.quickAdd('авто-1', 'today');
    const a2 = await services.tasks.quickAdd('авто-2', 'today');
    await deps.repos.tasks.update(a1.id, { autoMoveCount: 1 });
    await deps.repos.tasks.update(a2.id, { autoMoveCount: 2 });
    expect(await order(env, TODAY)).toEqual(['авто-1', 'авто-2', 'ручная']);
    await expect(services.tasks.move(m.id, 'up')).resolves.toBeNull();
    await expect(services.tasks.move(a2.id, 'up')).resolves.toEqual({ position: 1, total: 3 });
    expect(await order(env, TODAY)).toEqual(['авто-2', 'авто-1', 'ручная']);
  });

  it('совпадающие ключи (например, из двух вкладок): порядок по id, перемещение сначала перенумеровывает группу', async () => {
    const env = await readyEnv();
    const { services, deps } = env;
    const a = await services.tasks.quickAdd('A', 'today');
    const b = await services.tasks.quickAdd('B', 'today');
    const c = await services.tasks.quickAdd('C', 'today');
    for (const t of [a, b, c]) await deps.repos.tasks.update(t.id, { sortOrder: 'a0' });
    // uuid v7 растут со временем создания — при равных ключах порядок A, B, C.
    expect(await order(env, TODAY)).toEqual(['A', 'B', 'C']);
    await expect(services.tasks.move(c.id, 'up')).resolves.toEqual({ position: 2, total: 3 });
    expect(await order(env, TODAY)).toEqual(['A', 'C', 'B']);
    const keys = (await services.tasks.list()).map((t) => t.sortOrder);
    expect(new Set(keys).size).toBe(3);
  });

  it('ключ длиннее 32 символов — группа перенумеровывается одной транзакцией с сохранением порядка', async () => {
    const env = await readyEnv();
    const { services, deps } = env;
    const a = await services.tasks.quickAdd('A', 'today');
    const b = await services.tasks.quickAdd('B', 'today');
    // Многократное дублирование «сразу после оригинала» удлиняет ключи.
    for (let i = 0; i < 60; i++) await services.tasks.duplicate(a.id);
    const list = await services.tasks.list();
    expect(Math.max(...list.map((t) => t.sortOrder.length))).toBeLessThanOrEqual(SORT_KEY_MAX);
    const titles = await order(env, TODAY);
    expect(titles[0]).toBe('A');
    expect(titles.at(-1)).toBe('B');
    expect(titles).toHaveLength(62);

    // Ключ, выросший до 40 символов «со стороны», перенумеровывается при перемещении.
    await deps.repos.tasks.update(b.id, { sortOrder: 'a0' + 'V'.repeat(40) });
    const before = await order(env, TODAY);
    await services.tasks.move(b.id, 'up');
    const after = await services.tasks.list();
    expect(Math.max(...after.map((t) => t.sortOrder.length))).toBeLessThanOrEqual(SORT_KEY_MAX);
    expect(await order(env, TODAY)).toEqual([...before.slice(0, -2), before.at(-1), before.at(-2)]);
  });
});

describe('ручная смена даты (п. 6.8)', () => {
  it('задача на следующей неделе переносится в другой день: TaskMove manual, конец нового дня', async () => {
    const env = await readyEnv();
    const { services, deps } = env;
    await services.tasks.create(emptyDraft({ title: 'Уже там', scheduleType: 'date', plannedDate: '2026-10-14' }));
    const t = await services.tasks.create(emptyDraft({ title: 'Перенести', scheduleType: 'date', plannedDate: '2026-10-15' }));
    await services.tasks.update(t.id, { ...draftFromTask(t), plannedDate: '2026-10-14' });
    expect(await order(env, '2026-10-14')).toEqual(['Уже там', 'Перенести']);
    expect(await order(env, '2026-10-15')).toEqual([]);
    const moves = await deps.repos.taskMoves.list();
    expect(moves).toEqual([expect.objectContaining({ taskId: t.id, fromDate: '2026-10-15', toDate: '2026-10-14', reason: 'manual' })]);
  });

  it('ручные переносы могут повторяться (X→Y, Y→X)', async () => {
    const env = await readyEnv();
    const { services, deps } = env;
    const t = await services.tasks.create(emptyDraft({ title: 'Туда-сюда', scheduleType: 'date', plannedDate: '2026-10-15' }));
    const moved = await services.tasks.update(t.id, { ...draftFromTask(t), plannedDate: '2026-10-16' });
    await services.tasks.update(t.id, { ...draftFromTask(moved), plannedDate: '2026-10-15' });
    expect(await deps.repos.taskMoves.list()).toHaveLength(2);
  });

  it('смена приоритета или категории порядок не меняет', async () => {
    const env = await readyEnv();
    const { services } = env;
    const a = await services.tasks.quickAdd('A', 'today');
    await services.tasks.quickAdd('B', 'today');
    await services.tasks.update(a.id, { ...draftFromTask(a), priority: 'high' });
    expect(await order(env, TODAY)).toEqual(['A', 'B']);
  });

  it('с даты на «без даты» TaskMove не пишется', async () => {
    const env = await readyEnv();
    const { services, deps } = env;
    const t = await services.tasks.quickAdd('A', 'today');
    await services.tasks.update(t.id, { ...draftFromTask(t), scheduleType: 'none', plannedDate: null });
    expect(await deps.repos.taskMoves.list()).toHaveLength(0);
    expect(await order(env, null)).toEqual(['A']);
  });
});
