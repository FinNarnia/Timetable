import { describe, expect, it } from 'vitest';
import { validateCategoryName, sortCategories } from '../../src/domain/categories';
import { addDaysIso, formatIsoDate, localDateOf, toTimeOfDay } from '../../src/domain/dates';
import {
  canUncomplete,
  completionPatch,
  compareInDay,
  dayProgress,
  draftFromTask,
  duplicateDraft,
  emptyDraft,
  groupKey,
  isTimePassed,
  roundPercent,
  todayGroups,
  validateTaskDraft,
} from '../../src/domain/tasks';
import type { Task } from '../../src/domain/types';

const TODAY = '2026-10-09';
let n = 0;
function task(overrides: Partial<Task> = {}): Task {
  n++;
  return {
    id: `t${String(n).padStart(3, '0')}`,
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

describe('validateTaskDraft (п. 6.1, 6.5)', () => {
  it('название обязательно, обрезается, не длиннее 120 символов', () => {
    expect(validateTaskDraft(emptyDraft({ title: '   ' }), TODAY)).toEqual({ ok: false, errors: { title: 'Введите название задачи' } });
    expect(validateTaskDraft(emptyDraft({ title: 'я'.repeat(121) }), TODAY)).toMatchObject({ ok: false, errors: { title: expect.any(String) } });
    const ok = validateTaskDraft(emptyDraft({ title: `  ${'я'.repeat(120)}  ` }), TODAY);
    expect(ok.ok && ok.value.title).toBe('я'.repeat(120));
  });

  it('заметка до 2000 символов, переносы строк сохраняются', () => {
    expect(validateTaskDraft(emptyDraft({ title: 'a', note: 'x'.repeat(2001) }), TODAY).ok).toBe(false);
    const ok = validateTaskDraft(emptyDraft({ title: 'a', note: 'строка 1\nстрока 2' }), TODAY);
    expect(ok.ok && ok.value.note).toBe('строка 1\nстрока 2');
  });

  it('время без даты невозможно', () => {
    const r = validateTaskDraft(emptyDraft({ title: 'a', scheduleType: 'none', plannedTime: '10:00' }), TODAY);
    expect(r).toEqual({ ok: false, errors: { plannedTime: 'Время можно указать только вместе с датой' } });
  });

  it('«Дата» требует дату, «Дата и время» — ещё и время', () => {
    expect(validateTaskDraft(emptyDraft({ title: 'a', scheduleType: 'date' }), TODAY)).toMatchObject({ ok: false, errors: { plannedDate: 'Выберите дату' } });
    expect(validateTaskDraft(emptyDraft({ title: 'a', scheduleType: 'datetime', plannedDate: TODAY }), TODAY)).toMatchObject({
      ok: false,
      errors: { plannedTime: 'Укажите время' },
    });
    expect(validateTaskDraft(emptyDraft({ title: 'a', scheduleType: 'datetime', plannedDate: TODAY, plannedTime: '25:00' }), TODAY).ok).toBe(false);
  });

  it('прошедшую дату нельзя выбрать, но можно оставить прежнюю', () => {
    const past = '2026-10-01';
    expect(validateTaskDraft(emptyDraft({ title: 'a', scheduleType: 'date', plannedDate: past }), TODAY)).toMatchObject({
      ok: false,
      errors: { plannedDate: 'Дата не может быть в прошлом' },
    });
    expect(validateTaskDraft(emptyDraft({ title: 'a', scheduleType: 'date', plannedDate: past }), TODAY, past).ok).toBe(true);
  });

  it('«Без даты» очищает дату и время; «Дата» очищает время', () => {
    const none = validateTaskDraft(emptyDraft({ title: 'a', scheduleType: 'none', plannedDate: TODAY }), TODAY);
    expect(none.ok && [none.value.plannedDate, none.value.plannedTime]).toEqual([null, null]);
    const date = validateTaskDraft(emptyDraft({ title: 'a', scheduleType: 'date', plannedDate: TODAY, plannedTime: '10:00' }), TODAY);
    expect(date.ok && date.value.plannedTime).toBeNull();
  });
});

describe('прогресс дня (п. 7.2)', () => {
  it('без задач — процент не показывается', () => {
    expect(dayProgress([], TODAY)).toEqual({ done: 0, total: 0, percent: null });
    expect(dayProgress([task({ scheduleType: 'none', plannedDate: null })], TODAY).percent).toBeNull();
  });
  it('учитывает только сегодняшние неудалённые активные и выполненные задачи', () => {
    const tasks = [
      task({ status: 'completed', completedAt: '2026-10-09T08:00:00.000Z' }),
      task(),
      task(),
      task({ deletedAt: '2026-10-09T09:00:00.000Z' }),
      task({ plannedDate: '2026-10-10' }),
      task({ scheduleType: 'none', plannedDate: null, status: 'completed', completedAt: '2026-10-09T08:00:00.000Z' }),
      task({ status: 'missed' }),
    ];
    expect(dayProgress(tasks, TODAY)).toEqual({ done: 1, total: 3, percent: 33 });
  });
  it('100% и округление 0,5 вверх', () => {
    expect(dayProgress([task({ status: 'completed', completedAt: 'x' })], TODAY).percent).toBe(100);
    expect(roundPercent(1, 8)).toBe(13); // 12,5 → 13
    expect(roundPercent(2, 3)).toBe(67);
    expect(roundPercent(1, 3)).toBe(33);
  });
});

describe('группы экрана «Сегодня» (п. 7.1)', () => {
  const toLocal = (iso: string) => iso.slice(0, 10);
  it('сегодня: активные на сегодня — сначала по времени, затем по ручному порядку', () => {
    const a = task({ sortOrder: 'a2' });
    const b = task({ sortOrder: 'a1' });
    const c = task({ plannedTime: '14:00', scheduleType: 'datetime', sortOrder: 'a9' });
    const d = task({ plannedTime: '09:30', scheduleType: 'datetime', sortOrder: 'a8' });
    const g = todayGroups([a, b, c, d, task({ plannedDate: '2026-10-10' })], TODAY, toLocal);
    expect(g.today.map((t) => t.id)).toEqual([d.id, c.id, b.id, a.id]);
  });
  it('без даты и выполненные сегодня (последние сверху, включая задачи без даты)', () => {
    const undated = task({ scheduleType: 'none', plannedDate: null });
    const doneEarly = task({ status: 'completed', completedAt: '2026-10-09T07:00:00.000Z' });
    const doneLate = task({ scheduleType: 'none', plannedDate: null, status: 'completed', completedAt: '2026-10-09T12:00:00.000Z' });
    const doneYesterday = task({ status: 'completed', completedAt: '2026-10-08T12:00:00.000Z' });
    const g = todayGroups([undated, doneEarly, doneLate, doneYesterday], TODAY, toLocal);
    expect(g.undated.map((t) => t.id)).toEqual([undated.id]);
    expect(g.completedToday.map((t) => t.id)).toEqual([doneLate.id, doneEarly.id]);
    expect(g.today).toEqual([]);
  });
  it('совпадающие ключи сортировки упорядочиваются по id', () => {
    const x = task({ id: 'b', sortOrder: 'a1' });
    const y = task({ id: 'a', sortOrder: 'a1' });
    expect([x, y].sort(compareInDay).map((t) => t.id)).toEqual(['a', 'b']);
  });
});

describe('«Время прошло», выполнение, снятие отметки (п. 6.5, 6.9)', () => {
  it('метка только у активной задачи на сегодня с прошедшим временем', () => {
    const t = task({ scheduleType: 'datetime', plannedTime: '14:00' });
    expect(isTimePassed(t, TODAY, '14:01')).toBe(true);
    expect(isTimePassed(t, TODAY, '14:00')).toBe(false);
    expect(isTimePassed({ ...t, status: 'completed' }, TODAY, '15:00')).toBe(false);
    expect(isTimePassed({ ...t, plannedDate: '2026-10-10' }, TODAY, '15:00')).toBe(false);
    expect(isTimePassed(task(), TODAY, '23:59')).toBe(false);
  });
  it('досрочное выполнение одиночной задачи переносит её на сегодня', () => {
    expect(completionPatch(task({ plannedDate: '2026-10-12' }), TODAY, 'NOW')).toEqual({
      status: 'completed',
      completedAt: 'NOW',
      plannedDate: TODAY,
    });
  });
  it('экземпляр серии сохраняет дату, задача без даты даты не получает', () => {
    expect(completionPatch(task({ plannedDate: '2026-10-12', seriesId: 's', occurrenceDate: '2026-10-12' }), TODAY, 'NOW')).not.toHaveProperty('plannedDate');
    expect(completionPatch(task({ plannedDate: null, scheduleType: 'none' }), TODAY, 'NOW')).not.toHaveProperty('plannedDate');
  });
  it('снять отметку можно только в день выполнения', () => {
    const toLocal = (iso: string) => iso.slice(0, 10);
    expect(canUncomplete(task({ status: 'completed', completedAt: '2026-10-09T10:00:00.000Z' }), TODAY, toLocal)).toBe(true);
    expect(canUncomplete(task({ status: 'completed', completedAt: '2026-10-08T10:00:00.000Z' }), TODAY, toLocal)).toBe(false);
    expect(canUncomplete(task(), TODAY, toLocal)).toBe(false);
  });
});

describe('дублирование (п. 6.11)', () => {
  it('копирует поля пользователя, но не повторение', () => {
    const original = task({ title: 'Отчёт', note: 'n', priority: 'high', categoryId: 'cat', scheduleType: 'datetime', plannedTime: '10:00', plannedDate: '2026-10-12', seriesId: 's' });
    expect(duplicateDraft(original, TODAY)).toEqual({ ...draftFromTask(original) });
    expect(duplicateDraft(original, TODAY)).not.toHaveProperty('seriesId');
  });
  it('прошедшая дата заменяется сегодняшней', () => {
    expect(duplicateDraft(task({ plannedDate: '2026-10-01' }), TODAY).plannedDate).toBe(TODAY);
  });
  it('ключ группы', () => {
    expect(groupKey({ plannedDate: null })).toBe('none');
    expect(groupKey({ plannedDate: TODAY })).toBe(TODAY);
  });
});

describe('категории (п. 6.4)', () => {
  const existing = [
    { id: '1', normalizedName: 'работа', deletedAt: null },
    { id: '2', normalizedName: 'елка', deletedAt: null },
    { id: '3', normalizedName: 'старое', deletedAt: '2026-10-01T00:00:00.000Z' },
  ];
  it('уникальность без учёта регистра и ё/е', () => {
    expect(validateCategoryName('РАБОТА', existing)).toEqual({ ok: false, error: 'Категория с таким названием уже есть' });
    expect(validateCategoryName('  Ёлка ', existing)).toEqual({ ok: false, error: 'Категория с таким названием уже есть' });
  });
  it('удалённая категория имя не занимает; переименование самой себя допустимо', () => {
    expect(validateCategoryName('Старое', existing)).toEqual({ ok: true, name: 'Старое', normalizedName: 'старое' });
    expect(validateCategoryName('Работа', existing, '1').ok).toBe(true);
  });
  it('длина 1–30', () => {
    expect(validateCategoryName('  ', existing).ok).toBe(false);
    expect(validateCategoryName('я'.repeat(31), existing).ok).toBe(false);
    expect(validateCategoryName('я'.repeat(30), existing).ok).toBe(true);
  });
  it('сортировка по алфавиту', () => {
    expect(sortCategories([{ normalizedName: 'работа' }, { normalizedName: 'дом' }]).map((c) => c.normalizedName)).toEqual(['дом', 'работа']);
  });
});

describe('вспомогательные даты', () => {
  it('addDaysIso через конец месяца и года', () => {
    expect(addDaysIso('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');
  });
  it('formatIsoDate, toTimeOfDay, localDateOf', () => {
    expect(formatIsoDate('2026-10-09')).toBe('09.10.2026');
    expect(toTimeOfDay(new Date(2026, 9, 9, 7, 5))).toBe('07:05');
    expect(localDateOf(new Date(2026, 9, 9, 23, 30).toISOString())).toBe('2026-10-09');
  });
});
