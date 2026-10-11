import { addDaysIso } from './dates';
import type { IsoDate, RecurrenceRule, Task, TaskSeries } from './types';

/** Горизонт серии: экземпляры создаются в базе на сегодня + 13 дней (п. 6.6). */
export const HORIZON_DAYS = 14;

export function horizonEnd(today: IsoDate): IsoDate {
  return addDaysIso(today, HORIZON_DAYS - 1);
}

export type RepeatFrequency = RecurrenceRule['frequency'];

/** Повторение в форме задачи (п. 6.6). Число месяца берётся из первой даты. */
export type RepeatDraft = {
  frequency: RepeatFrequency;
  /** 1 — понедельник … 7 — воскресенье. */
  weekdays: number[];
  untilDate: IsoDate | null;
};

export const REPEAT_LABEL: Record<RepeatFrequency, string> = {
  daily: 'Каждый день',
  weekly: 'По дням недели',
  monthly: 'Каждый месяц',
};

export const WEEKDAY_LABELS: Array<[number, string, string]> = [
  [1, 'пн', 'понедельник'],
  [2, 'вт', 'вторник'],
  [3, 'ср', 'среда'],
  [4, 'чт', 'четверг'],
  [5, 'пт', 'пятница'],
  [6, 'сб', 'суббота'],
  [7, 'вс', 'воскресенье'],
];

function parts(date: IsoDate): [number, number, number] {
  return date.split('-').map(Number) as [number, number, number];
}

/** День недели по ISO 8601: 1 — понедельник … 7 — воскресенье. */
export function isoWeekday(date: IsoDate): number {
  const [y, m, d] = parts(date);
  const js = new Date(y, m - 1, d).getDay();
  return js === 0 ? 7 : js;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Правило по черновику повторения: для «По дням недели» — выбранные дни, для «Каждый месяц» — число первой даты. */
export function ruleFromRepeat(repeat: RepeatDraft, startDate: IsoDate): RecurrenceRule {
  return {
    frequency: repeat.frequency,
    interval: 1,
    weekdays: repeat.frequency === 'weekly' ? [...repeat.weekdays].sort((a, b) => a - b) : [],
    monthDay: repeat.frequency === 'monthly' ? parts(startDate)[2] : null,
  };
}

/** Черновик повторения по умолчанию: для «По дням недели» — день недели первой даты (п. 6.6). */
export function defaultRepeat(frequency: RepeatFrequency, firstDate: IsoDate): RepeatDraft {
  return { frequency, weekdays: frequency === 'weekly' ? [isoWeekday(firstDate)] : [], untilDate: null };
}

export function repeatFromSeries(series: Pick<TaskSeries, 'rule' | 'untilDate'>): RepeatDraft {
  return { frequency: series.rule.frequency, weekdays: [...series.rule.weekdays], untilDate: series.untilDate };
}

type RuleSource = Pick<TaskSeries, 'rule' | 'startDate' | 'untilDate'>;

/** Есть ли у серии экземпляр в этот день. Для 29–31 числа в коротком месяце — последний день месяца. */
export function occursOn(series: RuleSource, date: IsoDate): boolean {
  if (date < series.startDate) return false;
  if (series.untilDate && date > series.untilDate) return false;
  const { rule } = series;
  if (rule.frequency === 'daily') return true;
  if (rule.frequency === 'weekly') return rule.weekdays.includes(isoWeekday(date));
  const [y, m, d] = parts(date);
  const monthDay = rule.monthDay ?? parts(series.startDate)[2];
  return d === Math.min(monthDay, daysInMonth(y, m));
}

/** Даты экземпляров серии в диапазоне [from; to] включительно. */
export function occurrences(series: RuleSource, from: IsoDate, to: IsoDate): IsoDate[] {
  const result: IsoDate[] = [];
  let date = from < series.startDate ? series.startDate : from;
  const last = series.untilDate && series.untilDate < to ? series.untilDate : to;
  while (date <= last) {
    if (occursOn(series, date)) result.push(date);
    date = addDaysIso(date, 1);
  }
  return result;
}

/** Поля экземпляра по шаблону серии (п. 6.6, 13.6). */
export function instanceFields(
  series: TaskSeries,
  date: IsoDate,
): Omit<Task, 'id' | 'userId' | 'rev' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'sortOrder'> {
  return {
    calendarId: series.calendarId,
    title: series.title,
    note: series.note,
    status: 'active',
    priority: series.priority,
    categoryId: series.categoryId,
    scheduleType: series.scheduleType,
    plannedDate: date,
    plannedTime: series.scheduleType === 'datetime' ? series.plannedTime : null,
    seriesId: series.id,
    occurrenceDate: date,
    isException: false,
    autoMoveCount: 0,
    completedAt: null,
  };
}

/** Ключ экземпляра — пара серия + дата (уникальна, п. 6.6). */
export function occurrenceKey(seriesId: string, date: IsoDate): string {
  return `${seriesId}|${date}`;
}
