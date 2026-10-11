// Отчёты — раздел 9 ТЗ. Чистые функции: на входе данные периода, на выходе готовые цифры для экрана.
import { addDaysIso, localDateOf } from './dates';
import { isActiveOn, isPlannedOn, mondayOf, versionOn, weekDates, weekTarget } from './habits';
import { roundPercent } from './tasks';
import type { Habit, HabitCheck, HabitSchedule, IsoDate, Task, TaskMove } from './types';

export type ReportKind = 'week' | 'month';
/** Неделя — её понедельник (YYYY-MM-DD), месяц — YYYY-MM. */
export type ReportPeriod = { kind: 'week'; monday: IsoDate } | { kind: 'month'; month: string };

export type ReportHabit = { habit: Habit; versions: HabitSchedule[] };

export type ReportInput = {
  today: IsoDate;
  /** Локальная дата создания профиля. */
  profileCreated: IsoDate;
  /** Задачи периода, включая удалённые (фильтрация — здесь). */
  tasks: Task[];
  moves: TaskMove[];
  habits: ReportHabit[];
  /** Неудалённые отметки на интервале checksWindow(period). */
  checks: HabitCheck[];
};

export type Ratio = { done: number; planned: number };
export type TaskTotals = Ratio & { missed: number; autoMoves: number; doneUndated: number; percent: number | null };
export type HabitTotals = Ratio & { percent: number | null };

export type CellLevel = '0-24' | '25-49' | '50-74' | '75-100';
/** before — до создания профиля, ahead — будущий день, counted — входит в расчётный диапазон. */
export type DayState = 'before' | 'ahead' | 'counted';

export type ReportDay = {
  date: IsoDate;
  state: DayState;
  tasks: Ratio;
  /** Только «Каждый день» и «По дням недели» (решение 1 к эталонному набору). */
  habits: Ratio;
  /** Значение ячейки сетки: null — «нет плана» или день вне диапазона. */
  percent: number | null;
  level: CellLevel | null;
};

/**
 * Отметка в строке привычки недельного отчёта: done — засчитана, extra — отметка в незапланированный день (не считается),
 * missed — запланирован и не отмечен, open — сегодня, ещё не отмечен, free — активный день «Цели на неделю» без отметки,
 * off — не запланирован, inactive — привычки не было или она в архиве, ahead — будущий день.
 */
export type MarkState = 'done' | 'extra' | 'missed' | 'open' | 'free' | 'off' | 'inactive' | 'ahead';

export type HabitRow = {
  id: string;
  title: string;
  archived: boolean;
  /** «5 из 7», «2 из 3, неделя идёт», «Нет запланированных». */
  text: string;
  done: number;
  planned: number;
  percent: number | null;
  /** Идущая неделя «Цели на неделю», ещё не достигшая цели: «0 из 2, неделя идёт» (в процент не входит). */
  running: string | null;
  /** Только в недельном отчёте: 7 отметок пн–вс. */
  marks: Array<{ date: IsoDate; state: MarkState }>;
};

export type Report = {
  period: ReportPeriod;
  start: IsoDate;
  end: IsoDate;
  /** Расчётный диапазон (п. 9.1); null — период целиком раньше профиля. */
  range: [IsoDate, IsoDate] | null;
  asOfToday: boolean;
  canPrev: boolean;
  canNext: boolean;
  tasks: TaskTotals;
  habits: HabitTotals;
  days: ReportDay[];
  habitRows: HabitRow[];
};

export const NO_PLAN_TEXT = 'Нет запланированных';

/** Процент с округлением 0,5 вверх (п. 9.1); null — знаменатель 0 («—»). */
export function percentOf(done: number, planned: number): number | null {
  return planned === 0 ? null : roundPercent(done, planned);
}

/** Уровень ячейки — по округлённому проценту (решение 3). */
export function cellLevel(percent: number): CellLevel {
  if (percent < 25) return '0-24';
  if (percent < 50) return '25-49';
  if (percent < 75) return '50-74';
  return '75-100';
}

export function periodBounds(period: ReportPeriod): { start: IsoDate; end: IsoDate } {
  if (period.kind === 'week') return { start: period.monday, end: addDaysIso(period.monday, 6) };
  const [y, m] = period.month.split('-').map(Number) as [number, number];
  const last = new Date(y, m, 0).getDate();
  return { start: `${period.month}-01`, end: `${period.month}-${String(last).padStart(2, '0')}` };
}

export function currentPeriod(kind: ReportKind, today: IsoDate): ReportPeriod {
  return kind === 'week' ? { kind, monday: mondayOf(today) } : { kind, month: today.slice(0, 7) };
}

export function shiftPeriod(period: ReportPeriod, step: number): ReportPeriod {
  if (period.kind === 'week') return { kind: 'week', monday: addDaysIso(period.monday, 7 * step) };
  const [y, m] = period.month.split('-').map(Number) as [number, number];
  const d = new Date(y, m - 1 + step, 1);
  return { kind: 'month', month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` };
}

/** Строка периода из эталонного набора: «week:2026-10-05», «month:2026-10». */
export function parsePeriod(value: string): ReportPeriod {
  const [kind, rest] = value.split(':') as [string, string];
  return kind === 'week' ? { kind: 'week', monday: rest } : { kind: 'month', month: rest };
}

/** Недели «Цели на неделю», входящие в период: неделя месяца — по четвергу (ISO 8601, п. 9.3). */
export function periodWeeks(period: ReportPeriod): IsoDate[] {
  if (period.kind === 'week') return [period.monday];
  const { start, end } = periodBounds(period);
  const weeks: IsoDate[] = [];
  for (let m = mondayOf(start); m <= end; m = addDaysIso(m, 7)) {
    const thursday = addDaysIso(m, 3);
    if (thursday >= start && thursday <= end) weeks.push(m);
  }
  return weeks;
}

/** Интервал дат, отметки которого нужны отчёту: сам период плюс края недель по четвергу. */
export function checksWindow(period: ReportPeriod): { from: IsoDate; to: IsoDate } {
  const { start, end } = periodBounds(period);
  const weeks = periodWeeks(period);
  const from = weeks[0] && weeks[0] < start ? weeks[0] : start;
  const lastSunday = weeks.length > 0 ? addDaysIso(weeks[weeks.length - 1]!, 6) : end;
  return { from, to: lastSunday > end ? lastSunday : end };
}

/** Был ли объект на месте к концу дня D: не удалён или удалён позже этого дня («на момент окончания дня»). */
function existedAtEndOf(deletedAt: string | null, date: IsoDate): boolean {
  return deletedAt === null || localDateOf(deletedAt) > date;
}

function datesBetween(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

const ratioText = (done: number, planned: number) => (planned === 0 ? NO_PLAN_TEXT : `${done} из ${planned}`);
const runningText = (done: number, target: number) => `${done} из ${target}, неделя идёт`;

/** Отчёт за неделю или месяц (раздел 9). */
export function buildReport(period: ReportPeriod, input: ReportInput): Report {
  const { today, profileCreated } = input;
  const { start, end } = periodBounds(period);
  const lo = start > profileCreated ? start : profileCreated;
  const hi = end < today ? end : today;
  const range: [IsoDate, IsoDate] | null = lo <= hi ? [lo, hi] : null;
  const inRange = (d: IsoDate) => range !== null && d >= range[0] && d <= range[1];

  // Задачи по дням (п. 9.2).
  const taskDone = new Map<IsoDate, number>();
  const taskPlanned = new Map<IsoDate, number>();
  const bump = (map: Map<IsoDate, number>, d: IsoDate) => map.set(d, (map.get(d) ?? 0) + 1);
  const totals: TaskTotals = { done: 0, planned: 0, missed: 0, autoMoves: 0, doneUndated: 0, percent: null };

  for (const t of input.tasks) {
    if (t.plannedDate === null) {
      // «Выполнено без срока» — по дню completedAt.
      if (t.status !== 'completed' || t.completedAt === null) continue;
      const day = localDateOf(t.completedAt);
      if (inRange(day) && existedAtEndOf(t.deletedAt, day)) totals.doneUndated++;
      continue;
    }
    const d = t.plannedDate;
    if (!inRange(d) || !existedAtEndOf(t.deletedAt, d)) continue;
    if (t.status === 'completed') {
      totals.done++;
      bump(taskDone, d);
      bump(taskPlanned, d);
    } else if (t.status === 'missed') {
      totals.missed++;
      bump(taskPlanned, d);
    } else if (t.status === 'active' && d === today) {
      bump(taskPlanned, d); // «Осталось» — только сегодня
    }
  }
  for (const m of input.moves) {
    if (m.reason !== 'auto' || m.deletedAt !== null || !inRange(m.fromDate)) continue;
    totals.missed++;
    totals.autoMoves++;
    bump(taskPlanned, m.fromDate);
  }
  for (const n of taskPlanned.values()) totals.planned += n;
  totals.percent = percentOf(totals.done, totals.planned);

  // Привычки (п. 9.3).
  const checked = new Map<string, Set<IsoDate>>();
  for (const c of input.checks) {
    if (c.deletedAt !== null) continue;
    let set = checked.get(c.habitId);
    if (!set) checked.set(c.habitId, (set = new Set()));
    set.add(c.date);
  }
  const allDays = datesBetween(start, end);
  const rangeDays = range ? datesBetween(range[0], range[1]) : [];
  const weeks = periodWeeks(period);
  const currentMonday = mondayOf(today);
  const habitDone = new Map<IsoDate, number>();
  const habitPlanned = new Map<IsoDate, number>();
  const habitTotals: HabitTotals = { done: 0, planned: 0, percent: null };
  const habitRows: HabitRow[] = [];

  for (const { habit, versions } of input.habits) {
    if (versions.length === 0) continue;
    const marks = checked.get(habit.id) ?? new Set<IsoDate>();
    let done = 0;
    let planned = 0;
    let running: string | null = null;
    let shown = allDays.some((d) => d <= today && isActiveOn(versions, d));

    for (const d of rangeDays) {
      const v = versionOn(versions, d);
      if (!v || !v.active || v.type === 'weekly_target' || !isPlannedOn(versions, d)) continue;
      planned++;
      bump(habitPlanned, d);
      if (marks.has(d)) {
        done++;
        bump(habitDone, d);
      }
    }
    for (const monday of weeks) {
      if (monday > today || addDaysIso(monday, 6) < profileCreated) continue;
      const target = weekTarget(versions, monday);
      if (target === null) continue;
      shown = true;
      const count = weekDates(monday).filter((d) => marks.has(d) && isActiveOn(versions, d)).length;
      if (monday === currentMonday && count < target) {
        running = runningText(count, target); // неделя идёт — в процент не входит
        continue;
      }
      planned += target;
      done += Math.min(count, target);
    }
    if (!shown) continue;
    habitTotals.done += done;
    habitTotals.planned += planned;
    const latest = versions[versions.length - 1]!;
    habitRows.push({
      id: habit.id,
      title: habit.title,
      archived: !latest.active,
      text: period.kind === 'week' && running !== null ? running : ratioText(done, planned),
      done,
      planned,
      percent: percentOf(done, planned),
      running: period.kind === 'month' ? running : null,
      marks: period.kind === 'week' ? allDays.map((date) => ({ date, state: markState(versions, date, today, marks.has(date)) })) : [],
    });
  }
  habitTotals.percent = percentOf(habitTotals.done, habitTotals.planned);

  const days: ReportDay[] = allDays.map((date) => {
    const state: DayState = date < profileCreated ? 'before' : date > today ? 'ahead' : 'counted';
    const tasks = { done: taskDone.get(date) ?? 0, planned: taskPlanned.get(date) ?? 0 };
    const habits = { done: habitDone.get(date) ?? 0, planned: habitPlanned.get(date) ?? 0 };
    const percent = state === 'counted' ? percentOf(tasks.done + habits.done, tasks.planned + habits.planned) : null;
    return { date, state, tasks, habits, percent, level: percent === null ? null : cellLevel(percent) };
  });

  return {
    period,
    start,
    end,
    range,
    asOfToday: start <= today && today <= end,
    canPrev: addDaysIso(start, -1) >= profileCreated,
    canNext: end < today,
    tasks: totals,
    habits: habitTotals,
    days,
    habitRows,
  };
}

function markState(versions: HabitSchedule[], date: IsoDate, today: IsoDate, checked: boolean): MarkState {
  if (date > today) return 'ahead';
  const v = versionOn(versions, date);
  if (!v || !v.active) return 'inactive';
  if (v.type === 'weekly_target') return checked ? 'done' : 'free';
  if (!isPlannedOn(versions, date)) return checked ? 'extra' : 'off';
  if (checked) return 'done';
  return date === today ? 'open' : 'missed';
}

const MONTHS_NOMINATIVE = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

const parts = (d: IsoDate) => d.split('-').map(Number) as [number, number, number];

/** Заголовок периода: «пн, 5 окт — вс, 11 окт 2026» (п. 9.4), «Октябрь 2026» (п. 9.5). */
export function periodTitle(period: ReportPeriod): string {
  if (period.kind === 'month') {
    const [y, m] = period.month.split('-').map(Number) as [number, number];
    return `${MONTHS_NOMINATIVE[m - 1]} ${y}`;
  }
  const [y1, m1, d1] = parts(period.monday);
  const [y2, m2, d2] = parts(addDaysIso(period.monday, 6));
  const first = `пн, ${d1} ${MONTHS_SHORT[m1 - 1]}${y1 !== y2 ? ` ${y1}` : ''}`;
  return `${first} — вс, ${d2} ${MONTHS_SHORT[m2 - 1]} ${y2}`;
}

/** «12 октября». */
export function dayMonth(date: IsoDate): string {
  const [, m, d] = parts(date);
  return `${d} ${MONTHS_GENITIVE[m - 1]}`;
}

/** Подпись ячейки сетки (п. 9.5): «12 октября: 4 из 5, 80%», «… нет плана», «… впереди». */
export function cellLabel(day: ReportDay): string {
  const head = dayMonth(day.date);
  if (day.state === 'ahead') return `${head}: впереди`;
  if (day.state === 'before') return `${head}: до начала`;
  if (day.percent === null) return `${head}: нет плана`;
  const done = day.tasks.done + day.habits.done;
  const planned = day.tasks.planned + day.habits.planned;
  return `${head}: ${done} из ${planned}, ${day.percent}%`;
}

export const LEVEL_TEXT: Record<CellLevel | 'none' | 'ahead', string> = {
  none: 'нет плана',
  '0-24': '0–24%',
  '25-49': '25–49%',
  '50-74': '50–74%',
  '75-100': '75–100%',
  ahead: 'впереди',
};
