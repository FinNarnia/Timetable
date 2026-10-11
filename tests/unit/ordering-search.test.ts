import { describe, expect, it } from 'vitest';
import { generateNKeysBetween } from 'fractional-indexing';
import { dayLabel, formatShortDay } from '../../src/domain/dates';
import { normalize } from '../../src/domain/normalize';
import {
  compareInDay,
  daySegment,
  moveNeighbor,
  needsRenumber,
  searchTasks,
  SORT_KEY_MAX,
  upcomingGroups,
} from '../../src/domain/tasks';
import type { Task } from '../../src/domain/types';

const TODAY = '2026-10-09';
let n = 0;
function task(overrides: Partial<Task> = {}): Task {
  n++;
  return {
    id: `t${String(n).padStart(4, '0')}`,
    userId: 'u',
    rev: 1,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    deletedAt: null,
    calendarId: 'c',
    title: `Задача ${n}`,
    note: '',
    status: 'active',
    priority: 'normal',
    categoryId: null,
    scheduleType: 'date',
    plannedDate: TODAY,
    plannedTime: null,
    seriesId: null,
    occurrenceDate: null,
    isException: false,
    sortOrder: 'a0',
    autoMoveCount: 0,
    completedAt: null,
    ...overrides,
  };
}
const ids = (list: Task[]) => list.map((t) => t.title);
// Фиксированная локальная дата для completedAt — тесты не зависят от часового пояса машины.
const toLocal = (iso: string) => iso.slice(0, 10);

describe('единое правило порядка в дне (п. 6.13)', () => {
  it('со временем → автоперенесённые → ручной порядок', () => {
    const list = [
      task({ title: 'ручная-2', sortOrder: 'a2' }),
      task({ title: 'авто-2', sortOrder: 'a1', autoMoveCount: 1 }),
      task({ title: '15:00', plannedTime: '15:00', sortOrder: 'a0' }),
      task({ title: 'ручная-1', sortOrder: 'a0' }),
      task({ title: 'авто-1', sortOrder: 'a0', autoMoveCount: 3 }),
      task({ title: '09:30', plannedTime: '09:30', sortOrder: 'a9' }),
    ];
    expect(ids(list.sort(compareInDay))).toEqual(['09:30', '15:00', 'авто-1', 'авто-2', 'ручная-1', 'ручная-2']);
    expect(list.map(daySegment)).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it('совпадающие ключи — по id', () => {
    const a = task({ id: 'b', title: 'B', sortOrder: 'a1' });
    const b = task({ id: 'a', title: 'A', sortOrder: 'a1' });
    expect(ids([a, b].sort(compareInDay))).toEqual(['A', 'B']);
  });

  it('одинаковое время — по ключу', () => {
    const a = task({ title: 'поздний ключ', plannedTime: '10:00', sortOrder: 'a5' });
    const b = task({ title: 'ранний ключ', plannedTime: '10:00', sortOrder: 'a1' });
    expect(ids([a, b].sort(compareInDay))).toEqual(['ранний ключ', 'поздний ключ']);
  });
});

describe('«Выше» / «Ниже» (п. 6.13)', () => {
  const timed = task({ title: 'T', plannedTime: '08:00', sortOrder: 'a0' });
  const auto = task({ title: 'A', autoMoveCount: 1, sortOrder: 'a0' });
  const m1 = task({ title: 'M1', sortOrder: 'a0' });
  const m2 = task({ title: 'M2', sortOrder: 'a1' });
  const m3 = task({ title: 'M3', sortOrder: 'a2' });
  const group = [timed, auto, m1, m2, m3].sort(compareInDay);

  it('сосед в своей части группы', () => {
    expect(moveNeighbor(group, m2.id, 'up')).toBe(m1);
    expect(moveNeighbor(group, m2.id, 'down')).toBe(m3);
  });

  it('на краях и на границе частей — двигать некуда', () => {
    expect(moveNeighbor(group, m1.id, 'up')).toBeNull(); // выше — автоперенесённая
    expect(moveNeighbor(group, m3.id, 'down')).toBeNull();
    expect(moveNeighbor(group, auto.id, 'up')).toBeNull(); // выше — задача со временем
    expect(moveNeighbor(group, auto.id, 'down')).toBeNull();
  });

  it('задачи со временем, выполненные и неизвестные не двигаются', () => {
    expect(moveNeighbor(group, timed.id, 'down')).toBeNull();
    expect(moveNeighbor([m1, task({ status: 'completed', completedAt: 'x' })], m1.id, 'down')).toBeNull();
    expect(moveNeighbor(group, 'нет-такой', 'up')).toBeNull();
  });

  it('обмен ключей меняет порядок и не удлиняет ключи', () => {
    const a = task({ title: 'A1', sortOrder: 'a0' });
    const b = task({ title: 'B1', sortOrder: 'a1' });
    [a.sortOrder, b.sortOrder] = [b.sortOrder, a.sortOrder];
    expect(ids([a, b].sort(compareInDay))).toEqual(['B1', 'A1']);
    expect([a.sortOrder, b.sortOrder].sort()).toEqual(['a0', 'a1']);
  });
});

describe('перенумерация (п. 6.13)', () => {
  it('нужна при совпадении ключей', () => {
    expect(needsRenumber([{ sortOrder: 'a0' }, { sortOrder: 'a1' }])).toBe(false);
    expect(needsRenumber([{ sortOrder: 'a0' }, { sortOrder: 'a0' }])).toBe(true);
  });

  it('нужна, когда ключ длиннее 32 символов', () => {
    expect(needsRenumber([{ sortOrder: 'a'.repeat(SORT_KEY_MAX) }])).toBe(false);
    expect(needsRenumber([{ sortOrder: 'a'.repeat(SORT_KEY_MAX + 1) }])).toBe(true);
  });

  it('новые ключи по порядку показа сохраняют порядок и короткие', () => {
    const list = [task({ title: 'X', sortOrder: 'a0' + 'V'.repeat(40) }), task({ title: 'Y', sortOrder: 'a0' + 'V'.repeat(41) })];
    const keys = generateNKeysBetween(null, null, list.length);
    list.forEach((t, i) => (t.sortOrder = keys[i]!));
    expect(ids(list.sort(compareInDay))).toEqual(['X', 'Y']);
    expect(needsRenumber(list)).toBe(false);
  });
});

describe('«Предстоящие» (п. 7.3)', () => {
  it('от завтра, по дням, без пустых дней, порядок дня по правилу', () => {
    const list = [
      task({ title: 'сегодня' }),
      task({ title: 'без даты', plannedDate: null, scheduleType: 'none' }),
      task({ title: '12-е б', plannedDate: '2026-10-12', sortOrder: 'a1' }),
      task({ title: '12-е 09:00', plannedDate: '2026-10-12', plannedTime: '09:00', scheduleType: 'datetime' }),
      task({ title: 'завтра', plannedDate: '2026-10-10' }),
      task({ title: '12-е а', plannedDate: '2026-10-12', sortOrder: 'a0' }),
      task({ title: 'выполнена', plannedDate: '2026-10-11', status: 'completed', completedAt: '2026-10-09T10:00:00Z' }),
      task({ title: 'удалена', plannedDate: '2026-10-11', deletedAt: '2026-10-09T10:00:00Z' }),
      task({ title: 'через год', plannedDate: '2027-10-01' }),
    ];
    const groups = upcomingGroups(list, TODAY);
    expect(groups.map((g) => g.date)).toEqual(['2026-10-10', '2026-10-12', '2027-10-01']);
    expect(ids(groups[1]!.tasks)).toEqual(['12-е 09:00', '12-е а', '12-е б']);
  });

  it('подписи дней: «Завтра», «пн, 12 окт», другой год — с годом', () => {
    expect(dayLabel('2026-10-10', TODAY)).toBe('Завтра');
    expect(dayLabel('2026-10-09', TODAY)).toBe('Сегодня');
    expect(dayLabel('2026-10-12', TODAY)).toBe('пн, 12 окт');
    expect(formatShortDay('2026-05-03', TODAY)).toBe('вс, 3 мая');
    expect(formatShortDay('2027-01-01', TODAY)).toBe('пт, 1 янв 2027');
  });
});

describe('поиск (п. 7.4)', () => {
  const since = '2026-07-11'; // сегодня − 90 дней
  const run = (list: Task[], q: string) => searchTasks(list, q, TODAY, toLocal, normalize, since);

  it('пустой запрос — ничего не ищем', () => {
    expect(run([task({ title: 'Ёлка' })], '   ').total).toBe(0);
  });

  it('регистр и ё/е, подстрока', () => {
    const list = [task({ title: 'Купить ЁЛКУ' }), task({ title: 'елочные игрушки' }), task({ title: 'Хлеб' })];
    expect(ids(run(list, 'ёл').today)).toEqual(['Купить ЁЛКУ', 'елочные игрушки']);
    expect(run(list, 'ЕЛК').total).toBe(1);
    expect(run(list, '  хлеб ').total).toBe(1);
  });

  it('группы: сегодня (и раньше), предстоящие, без даты, выполненные; удалённые не ищутся', () => {
    const list = [
      task({ title: 'отчёт сегодня' }),
      task({ title: 'отчёт вчера', plannedDate: '2026-10-08' }),
      task({ title: 'отчёт 12-го', plannedDate: '2026-10-12' }),
      task({ title: 'отчёт завтра', plannedDate: '2026-10-10' }),
      task({ title: 'отчёт без даты', plannedDate: null, scheduleType: 'none' }),
      task({ title: 'отчёт сделан утром', status: 'completed', completedAt: '2026-10-09T08:00:00Z' }),
      task({ title: 'отчёт сделан вечером', status: 'completed', completedAt: '2026-10-09T20:00:00Z' }),
      task({ title: 'отчёт удалён', deletedAt: '2026-10-09T08:00:00Z' }),
    ];
    const r = run(list, 'Отчёт');
    expect(ids(r.today)).toEqual(['отчёт вчера', 'отчёт сегодня']);
    expect(ids(r.upcoming)).toEqual(['отчёт завтра', 'отчёт 12-го']);
    expect(ids(r.undated)).toEqual(['отчёт без даты']);
    expect(ids(r.completed)).toEqual(['отчёт сделан вечером', 'отчёт сделан утром']);
    expect(r.total).toBe(7);
  });

  it('выполненные — только за последние 90 дней; пропущенные не ищутся', () => {
    const list = [
      task({ title: 'старое', status: 'completed', completedAt: '2026-07-10T12:00:00Z' }),
      task({ title: 'граница', status: 'completed', completedAt: '2026-07-11T12:00:00Z' }),
      task({ title: 'пропущено', status: 'missed' }),
    ];
    expect(ids(run(list, 'о').completed)).toEqual([]);
    expect(ids(run(list, 'г').completed)).toEqual(['граница']);
    expect(run(list, 'пропущ').total).toBe(0);
  });

  it('5 000 задач — заметно быстрее 100 мс (п. 15.2)', () => {
    const list = Array.from({ length: 5000 }, (_, i) =>
      task({
        title: `Задача номер ${i} ${i % 7 === 0 ? 'ёлка' : 'дом'}`,
        plannedDate: i % 3 === 0 ? null : `2026-${String(10 + (i % 3)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
        status: i % 5 === 0 ? 'completed' : 'active',
        completedAt: i % 5 === 0 ? '2026-10-01T10:00:00Z' : null,
      }),
    );
    run(list, 'елк'); // прогрев
    const times: number[] = [];
    for (let k = 0; k < 5; k++) {
      const start = performance.now();
      const r = run(list, 'ЕЛК');
      times.push(performance.now() - start);
      expect(r.total).toBe(715);
    }
    expect(Math.min(...times)).toBeLessThan(100);
  });
});

describe('поиск: повторяющиеся задачи (п. 7.4)', () => {
  const since = '2026-07-11';
  const run = (list: Task[], q: string) => searchTasks(list, q, TODAY, toLocal, normalize, since);

  it('активные экземпляры серии — одной строкой, ближайшим от сегодня; выполненные — отдельно', () => {
    const inst = (date: string, extra: Partial<Task> = {}) =>
      task({ title: 'Зарядка', seriesId: 'S', occurrenceDate: date, plannedDate: date, ...extra });
    const list = [
      inst('2026-10-12'),
      inst('2026-10-10'),
      inst('2026-10-11'),
      inst('2026-10-09', { status: 'completed', completedAt: '2026-10-09T07:00:00Z' }),
      inst('2026-10-08', { status: 'missed' }),
      task({ title: 'Зарядка для глаз' }),
    ];
    const r = run(list, 'зарядка');
    expect(r.upcoming.map((t) => t.plannedDate)).toEqual(['2026-10-10']);
    expect(r.completed).toHaveLength(1);
    expect(r.today.map((t) => t.title)).toEqual(['Зарядка для глаз']);
    expect(r.total).toBe(3);
  });

  it('если сегодняшний активен — показывается он', () => {
    const list = ['2026-10-09', '2026-10-10'].map((d) => task({ title: 'Йога', seriesId: 'Y', occurrenceDate: d, plannedDate: d }));
    expect(run(list, 'йога').today.map((t) => t.plannedDate)).toEqual(['2026-10-09']);
    expect(run(list, 'йога').upcoming).toEqual([]);
  });
});
