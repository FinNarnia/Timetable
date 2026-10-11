import { addDaysIso, formatIsoDate } from './dates';
import { horizonEnd, occurrenceKey, occurrences } from './recurrence';
import type { IsoDate, Task, TaskMove, TaskSeries } from './types';

/** Через сколько дней после удаления очищаются название и заметка (п. 6.12, 10.2). */
export const PURGE_AFTER_DAYS = 90;

export type MaintenanceInput = {
  /** Все задачи профиля, включая мягко удалённые. */
  tasks: Task[];
  /** Все серии профиля, включая мягко удалённые. */
  series: TaskSeries[];
  /** Все записи переносов (для уникальности taskId + fromDate у автопереносов). */
  moves: TaskMove[];
  today: IsoDate;
  toLocalDate: (iso: string) => IsoDate;
};

export type MaintenancePlan = {
  /** Просроченные экземпляры серий → missed. */
  missed: Task[];
  /** Просроченные одиночные задачи → на сегодня; createMove = false, если запись уже есть. */
  autoMoves: Array<{ task: Task; fromDate: IsoDate; createMove: boolean }>;
  /** Недостающие экземпляры до горизонта. */
  newInstances: Array<{ series: TaskSeries; date: IsoDate }>;
  /** Серии, у которых сдвигается generatedUntil. */
  generatedUntil: Array<{ series: TaskSeries; until: IsoDate }>;
  /** Удалённые больше 90 дней назад записи, у которых ещё есть название или заметка. */
  purgeTasks: Task[];
  purgeSeries: TaskSeries[];
};

/**
 * План обслуживания дня (п. 6.10, 10.2). Чистая функция: по одному и тому же состоянию
 * всегда даёт один и тот же план, а применённый план даёт на следующем запуске пустой план.
 */
export function planMaintenance({ tasks, series, moves, today, toLocalDate }: MaintenanceInput): MaintenancePlan {
  const plan: MaintenancePlan = { missed: [], autoMoves: [], newInstances: [], generatedUntil: [], purgeTasks: [], purgeSeries: [] };
  const autoKeys = new Set(moves.filter((m) => m.reason === 'auto').map((m) => `${m.taskId}|${m.fromDate}`));
  const existing = new Set<string>();
  const purgeBefore = addDaysIso(today, -PURGE_AFTER_DAYS);

  for (const t of tasks) {
    if (t.seriesId && t.occurrenceDate) existing.add(occurrenceKey(t.seriesId, t.occurrenceDate));
    if (t.deletedAt !== null) {
      if (toLocalDate(t.deletedAt) < purgeBefore && (t.title !== '' || t.note !== '')) plan.purgeTasks.push(t);
      continue;
    }
    if (t.status !== 'active' || t.plannedDate === null || t.plannedDate >= today) continue;
    if (t.seriesId) plan.missed.push(t);
    else plan.autoMoves.push({ task: t, fromDate: t.plannedDate, createMove: !autoKeys.has(`${t.id}|${t.plannedDate}`) });
  }

  const end = horizonEnd(today);
  for (const s of series) {
    if (s.deletedAt !== null) {
      if (toLocalDate(s.deletedAt) < purgeBefore && (s.title !== '' || s.note !== '')) plan.purgeSeries.push(s);
      continue;
    }
    const from = s.generatedUntil >= today ? addDaysIso(s.generatedUntil, 1) : today;
    for (const date of occurrences(s, from, end)) {
      if (!existing.has(occurrenceKey(s.id, date))) plan.newInstances.push({ series: s, date });
    }
    if (s.generatedUntil < end) plan.generatedUntil.push({ series: s, until: end });
  }
  return plan;
}

export function isEmptyPlan(plan: MaintenancePlan): boolean {
  return Object.values(plan).every((list) => list.length === 0);
}

/**
 * Метка автопереноса (п. 6.10): «Перенесено с ДД.ММ», при autoMoveCount ≥ 3 — «Переносится N-й раз».
 * Показывается, пока задача стоит в дне, куда её перенесли автоматически.
 */
export function autoMoveLabel(task: Task, lastAutoMove: TaskMove | undefined): string | null {
  if (task.autoMoveCount === 0 || !lastAutoMove || lastAutoMove.toDate !== task.plannedDate) return null;
  if (task.autoMoveCount >= 3) return `Переносится ${task.autoMoveCount}-й раз`;
  return `Перенесено с ${formatIsoDate(lastAutoMove.fromDate).slice(0, 5)}`;
}

/** Последний автоперенос каждой задачи. */
export function lastAutoMoves(moves: TaskMove[]): Map<string, TaskMove> {
  const map = new Map<string, TaskMove>();
  for (const m of moves) {
    if (m.reason !== 'auto' || m.deletedAt !== null) continue;
    const prev = map.get(m.taskId);
    if (!prev || prev.toDate < m.toDate || (prev.toDate === m.toDate && prev.createdAt < m.createdAt)) map.set(m.taskId, m);
  }
  return map;
}
