import { describe, expect, it } from 'vitest';
import { HabitCheckError, HabitValidationError } from '../../src/application/habits';
import { archivedAtFor, emptyHabitDraft, isPlannedOn, weekDates } from '../../src/domain/habits';
import { makeEnv } from '../helpers';

const DAY = 24 * 3600 * 1000;
// Часы тестов: пятница, 9 октября 2026.

async function readyEnv(dbName?: string) {
  const env = makeEnv(dbName);
  await env.services.profile.start();
  await env.services.profile.create('Анна');
  return env;
}

async function view(env: Awaited<ReturnType<typeof readyEnv>>, id: string) {
  return (await env.services.habits.list()).find((h) => h.habit.id === id)!;
}

describe('привычки: создание и изменение (п. 8.2, 8.5)', () => {
  it('три типа; первая версия с сегодняшней даты; новая — в конец списка', async () => {
    const env = await readyEnv();
    const { habits } = env.services;
    const a = await habits.create(emptyHabitDraft({ title: 'Вода' }));
    const b = await habits.create(emptyHabitDraft({ title: 'Бассейн', type: 'weekdays', weekdays: [1, 3, 5] }));
    const c = await habits.create(emptyHabitDraft({ title: 'Бег', type: 'weekly_target', weeklyTarget: 2 }));
    const list = await habits.list();
    expect(list.map((x) => x.habit.title)).toEqual(['Вода', 'Бассейн', 'Бег']);
    expect(list[1]!.versions).toEqual([expect.objectContaining({ effectiveFrom: '2026-10-09', active: true, type: 'weekdays', weekdays: [1, 3, 5] })]);
    expect(list[2]!.versions[0]).toMatchObject({ type: 'weekly_target', weeklyTarget: 2 });
    expect([a, b, c].every((h) => h.archivedAt === null)).toBe(true);
    await expect(habits.create(emptyHabitDraft({ title: 'X', type: 'weekdays' }))).rejects.toBeInstanceOf(HabitValidationError);
  });

  it('изменение на неделе создания меняет первую версию; позже — версия с понедельника, повторно на той же неделе — перезапись', async () => {
    const env = await readyEnv();
    const { habits } = env.services;
    const h = await habits.create(emptyHabitDraft({ title: 'Бассейн', type: 'weekdays', weekdays: [1, 3, 5] }));
    await habits.update(h.id, emptyHabitDraft({ title: 'Бассейн', type: 'weekdays', weekdays: [1, 5] }));
    expect((await view(env, h.id)).versions).toEqual([expect.objectContaining({ effectiveFrom: '2026-10-09', weekdays: [1, 5] })]);

    env.clock.advance(5 * DAY); // ср, 14 окт
    await habits.update(h.id, emptyHabitDraft({ title: 'Плавание', type: 'weekdays', weekdays: [2, 4] }));
    await habits.update(h.id, emptyHabitDraft({ title: 'Плавание', type: 'weekdays', weekdays: [2, 4, 6] }));
    const v = await view(env, h.id);
    expect(v.habit.title).toBe('Плавание');
    expect(v.versions.map((x) => [x.effectiveFrom, x.weekdays])).toEqual([
      ['2026-10-09', [1, 5]],
      ['2026-10-12', [2, 4, 6]],
    ]);
    // 11.15: прошлая неделя — по старым дням, текущая — по новым.
    expect(weekDates('2026-10-05').filter((d) => isPlannedOn(v.versions, d))).toEqual(['2026-10-09']);
    expect(weekDates('2026-10-12').filter((d) => isPlannedOn(v.versions, d))).toEqual(['2026-10-13', '2026-10-15', '2026-10-17']);
  });

  it('смена только названия версий не создаёт', async () => {
    const env = await readyEnv();
    const h = await env.services.habits.create(emptyHabitDraft({ title: 'Чтение' }));
    env.clock.advance(7 * DAY);
    await env.services.habits.update(h.id, emptyHabitDraft({ title: 'Чтение 20 минут' }));
    expect((await view(env, h.id)).versions).toHaveLength(1);
  });
});

describe('отметки (п. 8.4)', () => {
  it('ставит, снимает и восстанавливает ту же запись (уникальность habitId + date)', async () => {
    const env = await readyEnv();
    const { habits } = env.services;
    const h = await habits.create(emptyHabitDraft({ title: 'Вода' }));
    expect(await habits.toggleCheck(h.id, '2026-10-09')).toBe(true);
    const first = await env.deps.repos.habitChecks.findByDay(h.id, '2026-10-09');
    expect(await habits.toggleCheck(h.id, '2026-10-09')).toBe(false);
    expect((await env.deps.repos.habitChecks.findByDay(h.id, '2026-10-09'))!.deletedAt).not.toBeNull();
    expect(await habits.checksBetween('2026-10-01', '2026-10-31')).toHaveLength(0);
    expect(await habits.toggleCheck(h.id, '2026-10-09')).toBe(true);
    const again = await env.deps.repos.habitChecks.findByDay(h.id, '2026-10-09');
    expect(again!.id).toBe(first!.id);
    expect(again!.deletedAt).toBeNull();
    expect(await env.deps.repos.habitChecks.list({ includeDeleted: true })).toHaveLength(1);
    // Уникальный индекс не даёт создать вторую запись даже напрямую.
    await expect(env.deps.repos.habitChecks.create({ habitId: h.id, date: '2026-10-09' })).rejects.toThrow();
  });

  it('окно: сегодня и 3 предыдущих дня, не раньше создания, не в будущем, только запланированные дни', async () => {
    const env = await readyEnv();
    const { habits } = env.services;
    const daily = await habits.create(emptyHabitDraft({ title: 'Вода' }));
    const mwf = await habits.create(emptyHabitDraft({ title: 'Бассейн', type: 'weekdays', weekdays: [1, 3, 5] }));
    await expect(habits.toggleCheck(daily.id, '2026-10-08')).rejects.toThrow('Привычки ещё не было в этот день');
    await expect(habits.toggleCheck(daily.id, '2026-10-10')).rejects.toBeInstanceOf(HabitCheckError);
    env.clock.advance(5 * DAY); // ср, 14 окт
    await expect(habits.toggleCheck(daily.id, '2026-10-11')).resolves.toBe(true);
    await expect(habits.toggleCheck(daily.id, '2026-10-10')).rejects.toThrow('Отметить можно только за сегодня и 3 предыдущих дня');
    await expect(habits.toggleCheck(mwf.id, '2026-10-13')).rejects.toThrow('В этот день привычка не запланирована');
    await expect(habits.toggleCheck(mwf.id, '2026-10-12')).resolves.toBe(true);
  });

  it('отметки другой привычки и снятые не попадают в выборку периода', async () => {
    const env = await readyEnv();
    const a = await env.services.habits.create(emptyHabitDraft({ title: 'А' }));
    const b = await env.services.habits.create(emptyHabitDraft({ title: 'Б' }));
    await env.services.habits.toggleCheck(a.id, '2026-10-09');
    await env.services.habits.toggleCheck(b.id, '2026-10-09');
    await env.services.habits.toggleCheck(b.id, '2026-10-09');
    expect((await env.services.habits.checksBetween('2026-10-09', '2026-10-09')).map((c) => c.habitId)).toEqual([a.id]);
    expect(await env.services.habits.checksBetween('2026-10-10', '2026-10-20')).toEqual([]);
  });
});

describe('архив (п. 8.6)', () => {
  it('убрать в архив, отменить, убрать снова, вернуть — archivedAt всегда по последней версии', async () => {
    const env = await readyEnv();
    const { habits } = env.services;
    const h = await habits.create(emptyHabitDraft({ title: 'Вода', type: 'weekly_target', weeklyTarget: 4 }));
    env.clock.advance(3 * DAY); // пн, 12 окт
    const token = await habits.archive(h.id);
    let v = await view(env, h.id);
    expect(v.habit.archivedAt).toBe('2026-10-12');
    expect(v.versions.map((x) => [x.effectiveFrom, x.active])).toEqual([
      ['2026-10-09', true],
      ['2026-10-12', false],
    ]);
    expect(isPlannedOn(v.versions, '2026-10-12')).toBe(false);

    await habits.undoArchive(token);
    v = await view(env, h.id);
    expect(v.habit.archivedAt).toBeNull();
    expect(v.versions).toHaveLength(1);

    await habits.archive(h.id);
    env.clock.advance(2 * DAY); // ср, 14 окт
    await habits.unarchive(h.id);
    v = await view(env, h.id);
    expect(v.habit.archivedAt).toBeNull();
    expect(v.versions.map((x) => [x.effectiveFrom, x.active, x.weeklyTarget])).toEqual([
      ['2026-10-09', true, 4],
      ['2026-10-12', false, 4],
      ['2026-10-14', true, 4],
    ]);
    expect(archivedAtFor(v.versions)).toBe(v.habit.archivedAt);
    // Промежуток в архиве в план не входит, с дня возврата — снова в плане.
    expect(['2026-10-12', '2026-10-13', '2026-10-14'].map((d) => isPlannedOn(v.versions, d))).toEqual([false, false, true]);
  });

  it('архивировать в день создания и вернуть в тот же день — версия меняется на месте', async () => {
    const env = await readyEnv();
    const h = await env.services.habits.create(emptyHabitDraft({ title: 'Вода' }));
    const token = await env.services.habits.archive(h.id);
    expect(token.createdVersionId).toBeNull();
    expect((await view(env, h.id)).versions).toEqual([expect.objectContaining({ active: false })]);
    await env.services.habits.unarchive(h.id);
    expect((await view(env, h.id)).versions).toEqual([expect.objectContaining({ active: true })]);
  });

  it('архивную привычку нельзя отметить и изменить', async () => {
    const env = await readyEnv();
    const h = await env.services.habits.create(emptyHabitDraft({ title: 'Вода' }));
    env.clock.advance(DAY);
    await env.services.habits.archive(h.id);
    await expect(env.services.habits.toggleCheck(h.id, '2026-10-10')).rejects.toThrow('Привычка была в архиве');
    await expect(env.services.habits.update(h.id, emptyHabitDraft({ title: 'Х' }))).rejects.toThrow();
  });
});

describe('ручной порядок (п. 8.7)', () => {
  it('«Выше / Ниже» среди активных, архивные не участвуют, порядок сохраняется', async () => {
    const env = await readyEnv();
    const { habits } = env.services;
    const [a, b, c] = [await habits.create(emptyHabitDraft({ title: 'А' })), await habits.create(emptyHabitDraft({ title: 'Б' })), await habits.create(emptyHabitDraft({ title: 'В' }))];
    await expect(habits.move(c.id, 'up')).resolves.toEqual({ position: 2, total: 3 });
    await expect(habits.move(a.id, 'up')).resolves.toBeNull();
    env.clock.advance(DAY);
    await habits.archive(b.id);
    await expect(habits.move(c.id, 'up')).resolves.toEqual({ position: 1, total: 2 });
    const active = (await habits.list()).filter((x) => x.habit.archivedAt === null).map((x) => x.habit.title);
    expect(active).toEqual(['В', 'А']);
  });
});
