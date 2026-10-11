import { describe, expect, it } from 'vitest';
import { autoMoveLabel, isEmptyPlan, lastAutoMoves, planMaintenance, PURGE_AFTER_DAYS } from '../../src/domain/maintenance';
import {
  defaultRepeat,
  horizonEnd,
  isoWeekday,
  occurrences,
  occursOn,
  repeatFromSeries,
  ruleFromRepeat,
} from '../../src/domain/recurrence';
import { addDaysIso } from '../../src/domain/dates';
import { emptyDraft, validateTaskDraft, type TaskDraft } from '../../src/domain/tasks';
import type { RecurrenceRule, Task, TaskMove, TaskSeries } from '../../src/domain/types';

const TODAY = '2026-10-09'; // пятница
const base = { userId: 'u', rev: 1, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', deletedAt: null };
let n = 0;

function series(rule: Partial<RecurrenceRule>, overrides: Partial<TaskSeries> = {}): TaskSeries {
  n++;
  return {
    ...base,
    id: `s${n}`,
    calendarId: 'c',
    title: `Серия ${n}`,
    note: '',
    priority: 'normal',
    categoryId: null,
    scheduleType: 'date',
    plannedTime: null,
    rule: { frequency: 'daily', interval: 1, weekdays: [], monthDay: null, ...rule },
    startDate: TODAY,
    untilDate: null,
    generatedUntil: addDaysIso(TODAY, -1),
    ...overrides,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  n++;
  return {
    ...base,
    id: `t${n}`,
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

const toLocal = (iso: string) => iso.slice(0, 10);

describe('правила повторения (п. 6.6)', () => {
  it('день недели по ISO: пн = 1 … вс = 7', () => {
    expect(isoWeekday('2026-10-05')).toBe(1);
    expect(isoWeekday('2026-10-09')).toBe(5);
    expect(isoWeekday('2026-10-11')).toBe(7);
  });

  it('каждый день — с первой даты по дату окончания включительно', () => {
    const s = series({ frequency: 'daily' }, { startDate: '2026-10-09', untilDate: '2026-10-12' });
    expect(occurrences(s, '2026-10-01', '2026-10-31')).toEqual(['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12']);
  });

  it('по дням недели: выбранные дни; «еженедельно» — один день', () => {
    const s = series({ frequency: 'weekly', weekdays: [1, 3] }, { startDate: '2026-10-09' });
    expect(occurrences(s, '2026-10-09', '2026-10-21')).toEqual(['2026-10-12', '2026-10-14', '2026-10-19', '2026-10-21']);
    const weekly = series({ frequency: 'weekly', weekdays: [5] });
    expect(occurrences(weekly, TODAY, '2026-10-31')).toEqual(['2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30']);
  });

  it('каждый месяц 31-го: в коротких месяцах — последний день', () => {
    const s = series({ frequency: 'monthly', monthDay: 31 }, { startDate: '2026-01-31' });
    expect(occurrences(s, '2026-01-01', '2026-07-31')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
      '2026-07-31',
    ]);
  });

  it('29-е и 30-е в феврале високосного и обычного года', () => {
    const d29 = series({ frequency: 'monthly', monthDay: 29 }, { startDate: '2027-12-29' });
    expect(occurrences(d29, '2028-02-01', '2028-03-31')).toEqual(['2028-02-29', '2028-03-29']);
    expect(occursOn(d29, '2029-02-28')).toBe(true);
    const d30 = series({ frequency: 'monthly', monthDay: 30 }, { startDate: '2026-01-30' });
    expect(occurrences(d30, '2028-02-01', '2028-02-29')).toEqual(['2028-02-29']);
    expect(occurrences(d30, '2027-02-01', '2027-02-28')).toEqual(['2027-02-28']);
  });

  it('до первой даты экземпляров нет', () => {
    const s = series({ frequency: 'daily' }, { startDate: '2026-10-20' });
    expect(occursOn(s, '2026-10-19')).toBe(false);
    expect(occurrences(s, TODAY, '2026-10-21')).toEqual(['2026-10-20', '2026-10-21']);
  });

  it('правило по черновику: дни недели упорядочены, число месяца — из первой даты', () => {
    expect(ruleFromRepeat({ frequency: 'weekly', weekdays: [5, 1], untilDate: null }, TODAY)).toEqual({
      frequency: 'weekly',
      interval: 1,
      weekdays: [1, 5],
      monthDay: null,
    });
    expect(ruleFromRepeat({ frequency: 'monthly', weekdays: [3], untilDate: null }, '2026-10-31').monthDay).toBe(31);
    expect(defaultRepeat('weekly', TODAY)).toEqual({ frequency: 'weekly', weekdays: [5], untilDate: null });
    expect(repeatFromSeries(series({ frequency: 'weekly', weekdays: [2] }, { untilDate: '2026-12-31' }))).toEqual({
      frequency: 'weekly',
      weekdays: [2],
      untilDate: '2026-12-31',
    });
  });

  it('горизонт — сегодня + 13 дней', () => {
    expect(horizonEnd(TODAY)).toBe('2026-10-22');
  });
});

describe('проверка повторения в форме (п. 6.6, 11.3)', () => {
  const dated = (repeat: TaskDraft['repeat']) =>
    emptyDraft({ title: 'X', scheduleType: 'date', plannedDate: TODAY, repeat });

  it('пустой список дней недели — ошибка', () => {
    const r = validateTaskDraft(dated({ frequency: 'weekly', weekdays: [], untilDate: null }), TODAY);
    expect(r).toEqual({ ok: false, errors: { repeatWeekdays: 'Выберите хотя бы один день недели' } });
  });

  it('дата окончания раньше первой даты — ошибка; равная — можно', () => {
    const r = validateTaskDraft(dated({ frequency: 'daily', weekdays: [], untilDate: '2026-10-08' }), TODAY);
    expect(r).toEqual({ ok: false, errors: { repeatUntil: 'Дата окончания — не раньше первой даты' } });
    expect(validateTaskDraft(dated({ frequency: 'daily', weekdays: [], untilDate: TODAY }), TODAY).ok).toBe(true);
  });

  it('для всей серии дата окончания сравнивается с первой датой серии', () => {
    const draft = emptyDraft({
      title: 'X',
      scheduleType: 'date',
      plannedDate: '2026-10-15',
      repeat: { frequency: 'daily', weekdays: [], untilDate: '2026-10-12' },
    });
    expect(validateTaskDraft(draft, TODAY, '2026-10-15', '2026-10-01').ok).toBe(true);
  });

  it('у задачи без даты повторение отбрасывается; дни недели чистятся', () => {
    const r = validateTaskDraft(emptyDraft({ title: 'X', repeat: { frequency: 'daily', weekdays: [], untilDate: null } }), TODAY);
    expect(r.ok && r.value.repeat).toBeNull();
    const w = validateTaskDraft(dated({ frequency: 'weekly', weekdays: [7, 1, 1, 9], untilDate: null }), TODAY);
    expect(w.ok && w.value.repeat).toEqual({ frequency: 'weekly', weekdays: [1, 7], untilDate: null });
  });
});

describe('обслуживание дня (п. 6.10, 10.2)', () => {
  it('просроченные экземпляры → missed, одиночные → автоперенос; выполненные и без даты не трогаются', () => {
    const s = series({ frequency: 'daily' }, { startDate: '2026-10-01', generatedUntil: '2026-10-22' });
    const single = task({ plannedDate: '2026-10-08' });
    const timed = task({ plannedDate: '2026-10-08', plannedTime: '09:00', scheduleType: 'datetime' });
    const instance = task({ plannedDate: '2026-10-08', seriesId: s.id, occurrenceDate: '2026-10-08' });
    const done = task({ plannedDate: '2026-10-08', status: 'completed', completedAt: '2026-10-08T10:00:00Z' });
    const undated = task({ plannedDate: null, scheduleType: 'none' });
    const today = task();
    const plan = planMaintenance({ tasks: [single, timed, instance, done, undated, today], series: [s], moves: [], today: TODAY, toLocalDate: toLocal });
    expect(plan.missed.map((t) => t.id)).toEqual([instance.id]);
    expect(plan.autoMoves.map((m) => [m.task.id, m.fromDate, m.createMove])).toEqual([
      [single.id, '2026-10-08', true],
      [timed.id, '2026-10-08', true],
    ]);
  });

  it('несколько дней без открытия — одна запись переноса с последней плановой даты', () => {
    const t = task({ plannedDate: '2026-10-03' });
    const plan = planMaintenance({ tasks: [t], series: [], moves: [], today: TODAY, toLocalDate: toLocal });
    expect(plan.autoMoves).toEqual([{ task: t, fromDate: '2026-10-03', createMove: true }]);
  });

  it('запись автопереноса для пары задача + дата не повторяется', () => {
    const t = task({ plannedDate: '2026-10-08' });
    const move: TaskMove = { ...base, id: 'm', taskId: t.id, fromDate: '2026-10-08', toDate: TODAY, reason: 'auto' };
    const plan = planMaintenance({ tasks: [t], series: [], moves: [move], today: TODAY, toLocalDate: toLocal });
    expect(plan.autoMoves[0]!.createMove).toBe(false);
  });

  it('недостающие экземпляры до горизонта, существующие и удалённые не создаются заново', () => {
    const s = series({ frequency: 'daily' }, { startDate: TODAY, generatedUntil: addDaysIso(TODAY, -1) });
    const existing = task({ seriesId: s.id, occurrenceDate: TODAY });
    const deleted = task({ seriesId: s.id, occurrenceDate: '2026-10-10', plannedDate: '2026-10-10', deletedAt: '2026-10-09T10:00:00Z' });
    const plan = planMaintenance({ tasks: [existing, deleted], series: [s], moves: [], today: TODAY, toLocalDate: toLocal });
    expect(plan.newInstances.map((x) => x.date)).toEqual(
      Array.from({ length: 12 }, (_, i) => addDaysIso(TODAY, i + 2)),
    );
    expect(plan.generatedUntil).toEqual([{ series: s, until: '2026-10-22' }]);
  });

  it('генерация продолжается от generatedUntil; удалённые серии и закончившиеся не генерируются', () => {
    const s = series({ frequency: 'daily' }, { startDate: '2026-10-01', generatedUntil: '2026-10-20' });
    const gone = series({ frequency: 'daily' }, { deletedAt: '2026-10-05T00:00:00Z' });
    const ended = series({ frequency: 'daily' }, { startDate: '2026-09-01', untilDate: '2026-09-30', generatedUntil: '2026-09-30' });
    const plan = planMaintenance({ tasks: [], series: [s, gone, ended], moves: [], today: TODAY, toLocalDate: toLocal });
    expect(plan.newInstances.map((x) => [x.series.id, x.date])).toEqual([
      [s.id, '2026-10-21'],
      [s.id, '2026-10-22'],
    ]);
  });

  it(`очистка названий и заметок удалённых больше ${PURGE_AFTER_DAYS} дней назад`, () => {
    const old = task({ deletedAt: '2026-07-10T12:00:00Z', title: 'Старое', note: 'x' });
    const fresh = task({ deletedAt: '2026-07-11T12:00:00Z', title: 'Свежее' });
    const purged = task({ deletedAt: '2026-01-01T12:00:00Z', title: '', note: '' });
    const oldSeries = series({}, { deletedAt: '2026-06-01T00:00:00Z' });
    const plan = planMaintenance({ tasks: [old, fresh, purged], series: [oldSeries], moves: [], today: TODAY, toLocalDate: toLocal });
    expect(plan.purgeTasks.map((t) => t.id)).toEqual([old.id]);
    expect(plan.purgeSeries.map((s) => s.id)).toEqual([oldSeries.id]);
  });

  it('применённый план даёт пустой план на повторном запуске', () => {
    const s = series({ frequency: 'daily' }, { startDate: TODAY, generatedUntil: '2026-10-22' });
    const instances = Array.from({ length: 14 }, (_, i) => {
      const d = addDaysIso(TODAY, i);
      return task({ seriesId: s.id, occurrenceDate: d, plannedDate: d });
    });
    const moved = task({ autoMoveCount: 1 });
    const plan = planMaintenance({ tasks: [...instances, moved], series: [s], moves: [], today: TODAY, toLocalDate: toLocal });
    expect(isEmptyPlan(plan)).toBe(true);
  });
});

describe('метки автопереноса (п. 6.10)', () => {
  const move = (taskId: string, fromDate: string, toDate: string, createdAt = '2026-10-09T00:00:00Z'): TaskMove => ({
    ...base,
    id: `m-${fromDate}`,
    createdAt,
    taskId,
    fromDate,
    toDate,
    reason: 'auto',
  });

  it('«Перенесено с ДД.ММ» и «Переносится N-й раз»', () => {
    const t1 = task({ autoMoveCount: 1 });
    expect(autoMoveLabel(t1, move(t1.id, '2026-10-08', TODAY))).toBe('Перенесено с 08.10');
    const t3 = task({ autoMoveCount: 3 });
    expect(autoMoveLabel(t3, move(t3.id, '2026-10-08', TODAY))).toBe('Переносится 3-й раз');
  });

  it('без автопереноса или после ручного переноса на другой день — без метки', () => {
    expect(autoMoveLabel(task(), undefined)).toBeNull();
    const t = task({ autoMoveCount: 1, plannedDate: '2026-10-12' });
    expect(autoMoveLabel(t, move(t.id, '2026-10-08', TODAY))).toBeNull();
  });

  it('последний автоперенос каждой задачи; ручные не учитываются', () => {
    const a = move('A', '2026-10-05', '2026-10-06');
    const b = move('A', '2026-10-08', TODAY);
    const manual: TaskMove = { ...move('A', TODAY, '2026-10-12'), id: 'mm', reason: 'manual' };
    expect(lastAutoMoves([b, a, manual]).get('A')).toBe(b);
  });
});
