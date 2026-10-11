import { describe, expect, it } from 'vitest';
import { ConflictError } from '../../src/application/tasks';
import { addDaysIso } from '../../src/domain/dates';
import { compareInDay, draftFromTask, emptyDraft, type TaskDraft } from '../../src/domain/tasks';
import type { RepeatDraft } from '../../src/domain/recurrence';
import type { Task } from '../../src/domain/types';
import { makeEnv } from '../helpers';

const DAY = 24 * 3600 * 1000;
const TODAY = '2026-10-09';

async function readyEnv(dbName?: string) {
  const env = makeEnv(dbName);
  await env.services.profile.start();
  await env.services.profile.create('Анна');
  return env;
}

function repeating(title: string, repeat: RepeatDraft, extra: Partial<TaskDraft> = {}): TaskDraft {
  return emptyDraft({ title, scheduleType: 'date', plannedDate: TODAY, repeat, ...extra });
}
const daily: RepeatDraft = { frequency: 'daily', weekdays: [], untilDate: null };

async function instances(env: Awaited<ReturnType<typeof readyEnv>>, seriesId: string, includeDeleted = false): Promise<Task[]> {
  return (await env.deps.repos.tasks.list({ includeDeleted }))
    .filter((t) => t.seriesId === seriesId)
    .sort((a, b) => (a.occurrenceDate! < b.occurrenceDate! ? -1 : 1));
}

describe('серии (п. 6.6)', () => {
  it('ежедневная серия: экземпляры на 14 дней, первый — сегодня', async () => {
    const env = await readyEnv();
    const { series, first } = await env.services.series.create(repeating('Зарядка', daily, { plannedTime: '07:30', scheduleType: 'datetime' }));
    expect(first).toMatchObject({ plannedDate: TODAY, seriesId: series.id, occurrenceDate: TODAY, plannedTime: '07:30' });
    const list = await instances(env, series.id);
    expect(list.map((t) => t.occurrenceDate)).toEqual(Array.from({ length: 14 }, (_, i) => addDaysIso(TODAY, i)));
    expect(series.generatedUntil).toBe('2026-10-22');
  });

  it('серия, начинающаяся за горизонтом, пока без экземпляров', async () => {
    const env = await readyEnv();
    const { first, series } = await env.services.series.create(repeating('Отчёт', { frequency: 'monthly', weekdays: [], untilDate: null }, { plannedDate: '2026-11-30' }));
    expect(first).toBeNull();
    expect(series.rule.monthDay).toBe(30);
    // Через 40 дней экземпляр на 30 ноября появляется при обслуживании дня.
    env.clock.advance(40 * DAY);
    await env.services.day.maintain();
    expect((await instances(env, series.id)).map((t) => t.plannedDate)).toEqual(['2026-11-30']);
  });

  it('включение повторения у одиночной задачи: она становится первым экземпляром', async () => {
    const env = await readyEnv();
    const t = await env.services.tasks.quickAdd('Полить цветы', 'today');
    const { series, first } = await env.services.series.enableRepeat(t.id, {
      ...draftFromTask(t),
      repeat: { frequency: 'weekly', weekdays: [5, 1], untilDate: null },
    });
    expect(first).toMatchObject({ id: t.id, seriesId: series.id, occurrenceDate: TODAY });
    expect((await instances(env, series.id)).map((x) => x.occurrenceDate)).toEqual([TODAY, '2026-10-12', '2026-10-16', '2026-10-19']);
  });

  it('«Только эту задачу»: исключение — независимый снимок', async () => {
    const env = await readyEnv();
    const { series } = await env.services.series.create(repeating('Пробежка', daily));
    const [, second] = await instances(env, series.id);
    const ex = await env.services.series.updateInstance(second!.id, { ...draftFromTask(second!), title: 'Пробежка 10 км', plannedDate: '2026-10-11' });
    expect(ex).toMatchObject({ isException: true, title: 'Пробежка 10 км', plannedDate: '2026-10-11', occurrenceDate: '2026-10-10' });
    const s = (await env.services.series.get(series.id))!;
    expect(s.title).toBe('Пробежка');

    // Изменение всей серии исключение не трогает.
    const today = (await instances(env, series.id))[0]!;
    await env.services.series.updateSeries(today.id, { ...draftFromTask(today), title: 'Бег', priority: 'high', repeat: daily });
    const after = await instances(env, series.id);
    expect(after.find((t) => t.id === second!.id)).toMatchObject({ title: 'Пробежка 10 км', priority: 'normal' });
    expect(after.filter((t) => t.id !== second!.id).every((t) => t.title === 'Бег' && t.priority === 'high')).toBe(true);
  });

  it('«Всю серию»: будущие пересоздаются по новому правилу; выполненный сегодняшний, пропущенные и удалённые не меняются', async () => {
    const env = await readyEnv();
    const { services } = env;
    const { series } = await services.series.create(repeating('Йога', daily));
    let list = await instances(env, series.id);
    await services.tasks.complete(list[0]!.id); // выполненный сегодняшний
    await services.series.deleteInstance(list[2]!.id); // удалённый 11.10
    // Завтра: вчерашний выполнен, сегодняшний (10.10) не трогаем.
    env.clock.advance(DAY);
    await services.day.maintain();
    list = await instances(env, series.id);
    const tomorrow = list.find((t) => t.occurrenceDate === '2026-10-10')!;
    // Новое правило: только понедельники и среды.
    await services.series.updateSeries(tomorrow.id, { ...draftFromTask(tomorrow), title: 'Йога утром', repeat: { frequency: 'weekly', weekdays: [1, 3], untilDate: null } });
    const after = await instances(env, series.id, true);
    const byDate = new Map(after.map((t) => [t.occurrenceDate, t]));
    expect(byDate.get(TODAY)).toMatchObject({ status: 'completed', title: 'Йога' });
    expect(byDate.get('2026-10-11')!.deletedAt).not.toBeNull();
    const active = after.filter((t) => t.status === 'active' && t.deletedAt === null);
    expect(active.map((t) => t.occurrenceDate)).toEqual(['2026-10-12', '2026-10-14', '2026-10-19', '2026-10-21']);
    expect(active.every((t) => t.title === 'Йога утром')).toBe(true);
    // Сегодняшний (10.10, суббота) больше не в правиле — удалён.
    expect(byDate.has('2026-10-10')).toBe(false);
  });

  it('возврат к прежнему правилу снова создаёт экземпляры (пересозданные не блокируют даты)', async () => {
    const env = await readyEnv();
    const { series } = await env.services.series.create(repeating('Чтение', daily));
    let [first] = await instances(env, series.id);
    await env.services.series.updateSeries(first!.id, { ...draftFromTask(first!), repeat: { frequency: 'weekly', weekdays: [5], untilDate: null } });
    expect((await instances(env, series.id)).map((t) => t.occurrenceDate)).toEqual([TODAY, '2026-10-16']);
    [first] = await instances(env, series.id);
    await env.services.series.updateSeries(first!.id, { ...draftFromTask(first!), repeat: daily });
    expect(await instances(env, series.id)).toHaveLength(14);
  });

  it('дата окончания сокращает серию', async () => {
    const env = await readyEnv();
    const { series } = await env.services.series.create(repeating('Курс', daily));
    const [first] = await instances(env, series.id);
    await env.services.series.updateSeries(first!.id, { ...draftFromTask(first!), repeat: { ...daily, untilDate: '2026-10-11' } });
    expect((await instances(env, series.id)).map((t) => t.occurrenceDate)).toEqual([TODAY, '2026-10-10', '2026-10-11']);
  });

  it('удаление «Всю серию»: будущие активные, включая исключения; история остаётся; отмена возвращает всё', async () => {
    const env = await readyEnv();
    const { services } = env;
    const { series } = await services.series.create(repeating('Витамины', daily));
    let list = await instances(env, series.id);
    await services.tasks.complete(list[0]!.id);
    await services.series.updateInstance(list[3]!.id, { ...draftFromTask(list[3]!), title: 'Витамины D' });
    env.clock.advance(DAY);
    await services.day.maintain();
    list = await instances(env, series.id);
    const token = await services.series.deleteSeries(list[1]!.id);
    expect(token.seriesIds).toEqual([series.id]);
    const left = await instances(env, series.id);
    expect(left.map((t) => [t.occurrenceDate, t.status])).toEqual([[TODAY, 'completed']]);
    expect(await services.series.get(series.id)).toBeUndefined();
    // Обслуживание удалённую серию не продолжает.
    env.clock.advance(DAY);
    await services.day.maintain();
    expect(await instances(env, series.id)).toHaveLength(1);
    await services.tasks.undoDelete(token);
    expect(await services.series.get(series.id)).toBeDefined();
    expect((await instances(env, series.id)).length).toBeGreaterThan(10);
  });

  it('удалённый экземпляр не создаётся заново', async () => {
    const env = await readyEnv();
    const { series } = await env.services.series.create(repeating('Шаги', daily));
    const list = await instances(env, series.id);
    await env.services.series.deleteInstance(list[5]!.id);
    env.clock.advance(DAY);
    await env.services.day.maintain();
    const dates = (await instances(env, series.id)).map((t) => t.occurrenceDate);
    expect(dates).not.toContain(list[5]!.occurrenceDate);
    expect(dates).toContain('2026-10-23');
  });

  it('досрочное выполнение экземпляра сохраняет его дату', async () => {
    const env = await readyEnv();
    const { series } = await env.services.series.create(repeating('Звонок', daily));
    const list = await instances(env, series.id);
    expect(await env.services.tasks.complete(list[3]!.id)).toMatchObject({ status: 'completed', plannedDate: '2026-10-12' });
  });
});

describe('обслуживание дня (п. 10.2)', () => {
  it('11.8: одиночная переносится с меткой и в начало дня, вчерашний экземпляр — missed; повторный запуск ничего не меняет', async () => {
    const env = await readyEnv();
    const { services, deps } = env;
    const a = await services.tasks.quickAdd('Задача А', 'today');
    const { series } = await services.series.create(repeating('Серия Б', daily));
    env.clock.advance(DAY);
    await services.tasks.quickAdd('Сегодняшняя', 'today');
    const result = await services.day.maintain();
    expect(result).toMatchObject({ ran: true, missed: 1, autoMoved: 1, created: 1 });

    const today = '2026-10-10';
    const tasks = await services.tasks.list();
    const order = tasks.filter((t) => t.status === 'active' && t.plannedDate === today).sort(compareInDay).map((t) => t.title);
    expect(order[0]).toBe('Задача А');
    expect(tasks.find((t) => t.id === a.id)).toMatchObject({ plannedDate: today, autoMoveCount: 1 });
    expect(await deps.repos.taskMoves.list()).toEqual([expect.objectContaining({ taskId: a.id, fromDate: TODAY, toDate: today, reason: 'auto' })]);
    const inst = await instances(env, series.id);
    expect(inst.find((t) => t.occurrenceDate === TODAY)!.status).toBe('missed');
    expect(inst.find((t) => t.occurrenceDate === today)!.status).toBe('active');
    expect((await deps.repos.settings.get())!.lastMaintenanceDate).toBe(today);

    const snapshot = await deps.dataStore.readAll();
    await expect(services.day.maintain()).resolves.toMatchObject({ ran: false });
    expect(await deps.dataStore.readAll()).toEqual(snapshot);
  });

  it('несколько дней простоя: одна запись переноса, счётчик +1; на третий раз — «Переносится 3-й раз»', async () => {
    const env = await readyEnv();
    const { services, deps } = env;
    const a = await services.tasks.quickAdd('Долгая', 'today');
    env.clock.advance(5 * DAY);
    await services.day.maintain();
    expect(await deps.repos.taskMoves.list()).toHaveLength(1);
    for (let i = 0; i < 2; i++) {
      env.clock.advance(DAY);
      await services.day.maintain();
    }
    expect((await deps.repos.tasks.getById(a.id))!.autoMoveCount).toBe(3);
    expect(await deps.repos.taskMoves.list()).toHaveLength(3);
  });

  it('задача со временем переносится с тем же временем', async () => {
    const env = await readyEnv();
    const t = await env.services.tasks.create(emptyDraft({ title: 'Созвон', scheduleType: 'datetime', plannedDate: TODAY, plannedTime: '09:00' }));
    env.clock.advance(DAY);
    await env.services.day.maintain();
    expect(await env.deps.repos.tasks.getById(t.id)).toMatchObject({ plannedDate: '2026-10-10', plannedTime: '09:00' });
  });

  it('одновременный запуск из двух контекстов: без дублей переносов и экземпляров', async () => {
    const one = await readyEnv();
    await one.services.tasks.quickAdd('А', 'today');
    await one.services.series.create(repeating('Б', daily));
    const two = makeEnv(one.dbName);
    await two.services.profile.start();
    one.clock.advance(DAY);
    two.clock.set(one.clock.now());
    const results = await Promise.all([one.services.day.maintain(), two.services.day.maintain(), one.services.day.maintain()]);
    expect(results.filter((r) => r.ran)).toHaveLength(1);
    expect(await one.deps.repos.taskMoves.list()).toHaveLength(1);
    const all = await one.deps.repos.tasks.list();
    const keys = all.filter((t) => t.seriesId).map((t) => t.occurrenceDate);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('ошибка посреди обслуживания откатывает всё', async () => {
    const env = await readyEnv();
    const { services, deps } = env;
    await services.tasks.quickAdd('А', 'today');
    await services.tasks.quickAdd('Б', 'today');
    env.clock.advance(DAY);
    const before = await deps.dataStore.readAll();
    const moves = deps.maintenance!.repos.taskMoves; // обслуживание идёт через своё подключение
    const original = moves.createMany.bind(moves);
    let calls = 0;
    // Синхронный сбой: лишняя «нативная» async-обёртка вокруг вызова Dexie сбивает зону транзакции Dexie
    // (запись ушла бы мимо транзакции) — в коде приложения таких обёрток нет, это проверено отдельно.
    moves.createMany = (data) => {
      if (++calls === 1) throw new Error('сбой записи'); // задачи уже перенесены, записи переносов — сбой
      return original(data);
    };
    await expect(services.day.maintain()).rejects.toThrow('сбой записи');
    expect(await deps.dataStore.readAll()).toEqual(before);
    moves.createMany = original;
    await expect(services.day.maintain()).resolves.toMatchObject({ ran: true, autoMoved: 2 });
  });

  it('очистка названий удалённых больше 90 дней назад', async () => {
    const env = await readyEnv();
    const t = await env.services.tasks.quickAdd('Секрет', 'today');
    await env.services.tasks.delete(t.id);
    env.clock.advance(91 * DAY);
    await env.services.day.maintain();
    expect(await env.deps.repos.tasks.getById(t.id, { includeDeleted: true })).toMatchObject({ title: '', note: '' });
  });

  // Порог 300 мс (п. 15.2) проверяется в настоящем браузере (e2e/day.spec.ts): fake-indexeddb на порядок медленнее
  // настоящей IndexedDB на массовых записях, здесь проверяется только результат на том же объёме.
  it('500 активных задач и 50 серий: всё обслуживание одной транзакцией', async () => {
    const env = await readyEnv();
    const { services, deps } = env;
    await deps.uow.run(async () => {
      const [calendar] = await deps.repos.calendars.list();
      for (let i = 0; i < 500; i++) {
        await deps.repos.tasks.create({
          ...emptyDraft({ title: `Задача ${i}`, scheduleType: 'date', plannedDate: addDaysIso(TODAY, -(i % 5)) }),
          repeat: undefined,
          calendarId: calendar!.id,
          status: 'active',
          seriesId: null,
          occurrenceDate: null,
          isException: false,
          sortOrder: `a${i}`,
          autoMoveCount: 0,
          completedAt: null,
        } as never);
      }
    });
    for (let i = 0; i < 50; i++) await services.series.create(repeating(`Серия ${i}`, daily));
    await deps.repos.settings.put({ ...(await deps.repos.settings.get())!, lastMaintenanceDate: TODAY });
    env.clock.advance(DAY);
    const start = performance.now();
    const result = await services.day.maintain();
    const elapsed = performance.now() - start;
    console.log(`Обслуживание дня: ${elapsed.toFixed(0)} мс`, result);
    expect(result).toMatchObject({ ran: true, autoMoved: 500, missed: 50, created: 50 });
    expect(await deps.repos.taskMoves.list()).toHaveLength(500);
  }, 60_000);
});

describe('несколько вкладок (п. 10.3)', () => {
  it('конфликт правок по rev; «Сохранить мои изменения» сохраняет без проверки', async () => {
    const env = await readyEnv();
    const t = await env.services.tasks.quickAdd('Общая', 'today');
    await env.services.tasks.update(t.id, { ...draftFromTask(t), title: 'Из другой вкладки' }, t.rev);
    await expect(env.services.tasks.update(t.id, { ...draftFromTask(t), title: 'Моя' }, t.rev)).rejects.toBeInstanceOf(ConflictError);
    await expect(env.services.tasks.update(t.id, { ...draftFromTask(t), title: 'Моя' })).resolves.toMatchObject({ title: 'Моя' });
  });

  it('конфликт и у экземпляра серии', async () => {
    const env = await readyEnv();
    const { first } = await env.services.series.create(repeating('Серия', daily));
    await env.services.tasks.complete(first!.id);
    await expect(env.services.series.updateInstance(first!.id, { ...draftFromTask(first!), title: 'X' }, first!.rev)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(env.services.series.updateSeries(first!.id, { ...draftFromTask(first!), repeat: daily }, first!.rev)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('после записи другим вкладкам уходит data-changed с типами сущностей', async () => {
    const env = await readyEnv();
    const listener = new BroadcastChannel('moy-ritm');
    const messages: unknown[] = [];
    listener.onmessage = (e) => messages.push(e.data);
    await env.services.tasks.quickAdd('Сообщение', 'today');
    await new Promise((r) => setTimeout(r, 50));
    listener.close();
    // Канал общий для всего процесса: среди сообщений есть и сообщения других тестов — ищем своё.
    expect(messages).toContainEqual({ type: 'data-changed', entities: expect.arrayContaining(['tasks']) });
  });
});
