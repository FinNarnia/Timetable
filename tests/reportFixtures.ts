// Загрузка эталонного набора отчётов (fixtures/reports/cases.json) в сущности приложения и сравнение с ожиданием.
import raw from '../fixtures/reports/cases.json' with { type: 'json' };
import { defaultSettings, makeProfile, PERSONAL_CALENDAR_NAME } from '../src/domain/profile';
import { cellLabel, type Report, type ReportDay } from '../src/domain/reports';
import type { DataSet, Habit, HabitCheck, HabitSchedule, Task, TaskMove } from '../src/domain/types';

type FxTask = {
  id: string;
  date: string | null;
  status: Task['status'];
  completed?: string;
  deleted?: string;
  series?: string;
  time?: string;
};
type FxVersion = { from: string; type?: HabitSchedule['type']; weekdays?: number[]; target?: number; archived?: boolean };
type FxHabit = { id: string; title: string; versions: FxVersion[]; checks: string[] };
type DayExp = { tasks: [number, number]; habits: [number, number] } | 'ahead' | 'before';
type CellExp = { done: number; planned: number; percent: number; level: string } | 'ahead' | 'before' | 'none';
export type Expected = {
  range?: [string, string];
  asOfToday?: boolean;
  canPrev?: boolean;
  canNext?: boolean;
  tasks?: Record<string, number | null>;
  habits?: Record<string, number | null>;
  days?: Record<string, DayExp>;
  cells?: Record<string, CellExp>;
  cellLabel?: Record<string, string>;
  habitRows?: Array<Record<string, unknown>>;
};
export type FxCase = {
  id: string;
  title: string;
  today: string;
  profileCreated: string;
  tasks?: FxTask[];
  moves?: Array<{ task: string; from: string; to: string; reason: 'auto' | 'manual' }>;
  habits?: FxHabit[];
  reports: Array<{ period: string; expected: Expected }>;
};

export const REPORT_CASES = (raw as unknown as { cases: FxCase[] }).cases;

export const USER = '0192aaaa-0000-7000-8000-000000000001';
const CALENDAR = '0192aaaa-0000-7000-8000-0000000000ca';

/** «2026-10-13 23:30» в локальном поясе → ISO UTC. */
export function localIso(value: string): string {
  const [d, t = '12:00'] = value.split(' ') as [string, string?];
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  const [h, mi] = t.split(':').map(Number) as [number, number];
  return new Date(y, m - 1, day, h, mi).toISOString();
}

/** Детерминированный uuid v7-подобный id из короткого имени фикстуры. */
function fxId(kind: string, name: string): string {
  const hex = [...`${kind}:${name}`].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 0xffffffffffff, 7).toString(16).padStart(12, '0');
  return `0192aaaa-0000-7000-8000-${hex}`;
}

export function caseData(c: FxCase): DataSet {
  const created = localIso(`${c.profileCreated} 09:00`);
  const base = (createdAt = created) => ({ userId: USER, rev: 1, createdAt, updatedAt: createdAt, deletedAt: null as string | null });
  const profile = makeProfile(USER, 'Анна', created);
  const settings = { ...defaultSettings(USER, created), lastMaintenanceDate: c.today };
  const seriesIds = new Set<string>();
  const tasks: Task[] = (c.tasks ?? []).map((t, i) => {
    if (t.series) seriesIds.add(t.series);
    return {
      ...base(),
      id: fxId('task', t.id),
      deletedAt: t.deleted ? localIso(t.deleted) : null,
      calendarId: CALENDAR,
      title: t.id,
      note: '',
      status: t.status,
      priority: 'normal',
      categoryId: null,
      scheduleType: t.date === null ? 'none' : t.time ? 'datetime' : 'date',
      plannedDate: t.date,
      plannedTime: t.time ?? null,
      seriesId: t.series ? fxId('series', t.series) : null,
      occurrenceDate: t.series ? t.date : null,
      isException: false,
      sortOrder: `a${String(i).padStart(3, '0')}`,
      autoMoveCount: 0,
      completedAt: t.completed ? localIso(t.completed) : null,
    };
  });
  const moves: TaskMove[] = (c.moves ?? []).map((m, i) => ({
    ...base(localIso(`${m.to} 00:01`)),
    id: fxId('move', `${m.task}:${i}`),
    taskId: fxId('task', m.task),
    fromDate: m.from,
    toDate: m.to,
    reason: m.reason,
  }));
  const habits: Habit[] = [];
  const habitSchedules: HabitSchedule[] = [];
  const habitChecks: HabitCheck[] = [];
  (c.habits ?? []).forEach((h, i) => {
    const habitId = fxId('habit', h.id);
    let last: FxVersion | undefined;
    for (const v of h.versions) {
      const fields = v.archived ? last! : v;
      if (!v.archived) last = v;
      habitSchedules.push({
        ...base(),
        id: fxId('version', `${h.id}:${v.from}`),
        habitId,
        effectiveFrom: v.from,
        active: !v.archived,
        type: fields.type!,
        weekdays: fields.type === 'weekdays' ? fields.weekdays! : [],
        weeklyTarget: fields.type === 'weekly_target' ? fields.target! : null,
      });
    }
    const lastVersion = h.versions[h.versions.length - 1]!;
    habits.push({ ...base(), id: habitId, title: h.title, sortOrder: `a${i}`, archivedAt: lastVersion.archived ? lastVersion.from : null });
    for (const date of h.checks) habitChecks.push({ ...base(localIso(`${date} 12:00`)), id: fxId('check', `${h.id}:${date}`), habitId, date });
  });
  const taskSeries = [...seriesIds].map((s) => ({
    ...base(),
    id: fxId('series', s),
    calendarId: CALENDAR,
    title: s,
    note: '',
    priority: 'normal' as const,
    categoryId: null,
    scheduleType: 'date' as const,
    plannedTime: null,
    rule: { frequency: 'daily' as const, interval: 1 as const, weekdays: [], monthDay: null },
    startDate: '2026-09-01',
    untilDate: '2026-09-01',
    generatedUntil: '2026-09-01',
  }));
  return {
    profile,
    settings,
    calendars: [{ ...base(), id: CALENDAR, name: PERSONAL_CALENDAR_NAME, kind: 'personal' }],
    categories: [],
    tasks,
    taskSeries,
    taskMoves: moves,
    habits,
    habitSchedules,
    habitChecks,
  };
}

/** Идентификатор привычки в отчёте → короткое имя из фикстуры. */
export function habitNames(c: FxCase): Map<string, string> {
  return new Map((c.habits ?? []).map((h) => [fxId('habit', h.id), h.id]));
}

function dayActual(d: ReportDay): DayExp {
  if (d.state !== 'counted') return d.state;
  return { tasks: [d.tasks.done, d.tasks.planned], habits: [d.habits.done, d.habits.planned] };
}

function cellActual(d: ReportDay): CellExp {
  if (d.state !== 'counted') return d.state;
  if (d.percent === null) return 'none';
  return { done: d.tasks.done + d.habits.done, planned: d.tasks.planned + d.habits.planned, percent: d.percent, level: d.level! };
}

/** Часть отчёта, которую описывает ожидание (только заданные ключи). */
export function actualFor(report: Report, expected: Expected, names: Map<string, string>): Expected {
  const byDate = new Map(report.days.map((d) => [d.date, d]));
  const pick = <T,>(keys: string[], fn: (d: ReportDay) => T) => Object.fromEntries(keys.map((k) => [k, byDate.has(k) ? fn(byDate.get(k)!) : 'нет дня']));
  const out: Expected = {};
  if (expected.range) out.range = report.range ?? undefined;
  if (expected.asOfToday !== undefined) out.asOfToday = report.asOfToday;
  if (expected.canPrev !== undefined) out.canPrev = report.canPrev;
  if (expected.canNext !== undefined) out.canNext = report.canNext;
  if (expected.tasks) out.tasks = Object.fromEntries(Object.keys(expected.tasks).map((k) => [k, report.tasks[k as keyof Report['tasks']]]));
  if (expected.habits) out.habits = Object.fromEntries(Object.keys(expected.habits).map((k) => [k, report.habits[k as keyof Report['habits']]]));
  if (expected.days) out.days = pick(Object.keys(expected.days), dayActual) as Expected['days'];
  if (expected.cells) out.cells = pick(Object.keys(expected.cells), cellActual) as Expected['cells'];
  if (expected.cellLabel) out.cellLabel = pick(Object.keys(expected.cellLabel), cellLabel) as Expected['cellLabel'];
  if (expected.habitRows) {
    out.habitRows = report.habitRows.map((row) => {
      const shape = expected.habitRows!.find((r) => r.id === names.get(row.id)) ?? expected.habitRows![0] ?? {};
      const full: Record<string, unknown> = { id: names.get(row.id), text: row.text, archived: row.archived, percent: row.percent, running: row.running ?? undefined };
      return Object.fromEntries(Object.keys(shape).map((k) => [k, full[k]]));
    });
  }
  return out;
}
