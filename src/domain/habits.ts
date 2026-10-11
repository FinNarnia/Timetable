import { addDaysIso } from './dates';
import { isoWeekday } from './recurrence';
import type { Habit, HabitCheck, HabitSchedule, HabitScheduleType, IsoDate } from './types';

export const HABIT_TITLE_MAX = 60;
/** Окно отметок задним числом: сегодня и 3 предыдущих дня (решение от 11.10.2026, уточняет п. 8.4). */
export const CHECK_WINDOW_DAYS = 3;
export const DEFAULT_WEEKLY_TARGET = 3;

export const HABIT_TYPE_LABEL: Record<HabitScheduleType, string> = {
  daily: 'Каждый день',
  weekdays: 'По дням недели',
  weekly_target: 'Цель на неделю',
};

/** Поля привычки, которые задаёт пользователь (п. 8.2). */
export type HabitDraft = {
  title: string;
  type: HabitScheduleType;
  weekdays: number[];
  weeklyTarget: number;
};

export type HabitDraftField = 'title' | 'weekdays' | 'weeklyTarget';
export type HabitDraftErrors = Partial<Record<HabitDraftField, string>>;
export type HabitScheduleFields = Pick<HabitSchedule, 'type' | 'weekdays' | 'weeklyTarget'>;

export function emptyHabitDraft(overrides: Partial<HabitDraft> = {}): HabitDraft {
  return { title: '', type: 'daily', weekdays: [], weeklyTarget: DEFAULT_WEEKLY_TARGET, ...overrides };
}

/**
 * Проверка формы привычки (п. 8.1–8.2). Все 7 дней недели = «Каждый день».
 * Возвращает название и поля расписания или ошибки по полям.
 */
export function validateHabitDraft(
  draft: HabitDraft,
): { ok: true; title: string; schedule: HabitScheduleFields } | { ok: false; errors: HabitDraftErrors } {
  const errors: HabitDraftErrors = {};
  const title = draft.title.trim();
  const len = [...title].length;
  if (len === 0) errors.title = 'Введите название привычки';
  else if (len > HABIT_TITLE_MAX) errors.title = `Название — не длиннее ${HABIT_TITLE_MAX} символов`;

  let schedule: HabitScheduleFields = { type: 'daily', weekdays: [], weeklyTarget: null };
  if (draft.type === 'weekdays') {
    const days = [...new Set(draft.weekdays)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b);
    if (days.length === 0) errors.weekdays = 'Выберите хотя бы один день недели';
    else if (days.length < 7) schedule = { type: 'weekdays', weekdays: days, weeklyTarget: null };
  } else if (draft.type === 'weekly_target') {
    const n = draft.weeklyTarget;
    if (!Number.isInteger(n) || n < 1 || n > 6) errors.weeklyTarget = 'Цель — от 1 до 6 раз в неделю';
    else schedule = { type: 'weekly_target', weekdays: [], weeklyTarget: n };
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, title, schedule };
}

export function draftFromHabit(habit: Habit, current: HabitScheduleFields | undefined): HabitDraft {
  return {
    title: habit.title,
    type: current?.type ?? 'daily',
    weekdays: current?.type === 'weekdays' ? [...current.weekdays] : [],
    weeklyTarget: current?.weeklyTarget ?? DEFAULT_WEEKLY_TARGET,
  };
}

/** Версии одной привычки по возрастанию даты начала (без удалённых). */
export function sortedVersions(schedules: HabitSchedule[]): HabitSchedule[] {
  return schedules.filter((s) => s.deletedAt === null).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
}

/** Действующая версия на день D — с наибольшим effectiveFrom ≤ D (п. 13.8). */
export function versionOn(versions: HabitSchedule[], date: IsoDate): HabitSchedule | undefined {
  let found: HabitSchedule | undefined;
  for (const v of versions) {
    if (v.effectiveFrom <= date) found = v;
    else break;
  }
  return found;
}

/** Последняя версия — текущее расписание (в том числе архивное). */
export function latestVersion(versions: HabitSchedule[]): HabitSchedule | undefined {
  return versions[versions.length - 1];
}

/** Последняя активная версия — параметры расписания для формы и возврата из архива. */
export function lastActiveVersion(versions: HabitSchedule[]): HabitSchedule | undefined {
  for (let i = versions.length - 1; i >= 0; i--) if (versions[i]!.active) return versions[i];
  return undefined;
}

/** Инвариант archivedAt (п. 13.8): если последняя версия неактивна — её effectiveFrom, иначе null. */
export function archivedAtFor(versions: HabitSchedule[]): IsoDate | null {
  const last = latestVersion(versions);
  return last && !last.active ? last.effectiveFrom : null;
}

/** Дата создания привычки — начало первой версии. */
export function creationDate(versions: HabitSchedule[]): IsoDate | undefined {
  return versions[0]?.effectiveFrom;
}

/** Привычка активна в этот день: есть версия и она не архивная. */
export function isActiveOn(versions: HabitSchedule[], date: IsoDate): boolean {
  return versionOn(versions, date)?.active === true;
}

/** Запланирован ли день (п. 8.1, 9.3): «Цель на неделю» — любой активный день. */
export function isPlannedOn(versions: HabitSchedule[], date: IsoDate): boolean {
  const v = versionOn(versions, date);
  if (!v || !v.active) return false;
  if (v.type === 'weekdays') return v.weekdays.includes(isoWeekday(date));
  return true;
}

export function mondayOf(date: IsoDate): IsoDate {
  return addDaysIso(date, 1 - isoWeekday(date));
}

export function weekDates(monday: IsoDate): IsoDate[] {
  return Array.from({ length: 7 }, (_, i) => addDaysIso(monday, i));
}

/** Месяц, в который входит неделя, — по её четвергу (ISO 8601, п. 9.3). Формат YYYY-MM. */
export function monthOfWeek(monday: IsoDate): string {
  return addDaysIso(monday, 3).slice(0, 7);
}

export type CheckBlock = 'future' | 'too-old' | 'before-created' | 'archived' | 'not-planned';

export const CHECK_BLOCK_TEXT: Record<CheckBlock, string> = {
  future: 'Будущий день — отметить пока нельзя',
  'too-old': `Отметить можно только за сегодня и ${CHECK_WINDOW_DAYS} предыдущих дня`,
  'before-created': 'Привычки ещё не было в этот день',
  archived: 'Привычка была в архиве',
  'not-planned': 'В этот день привычка не запланирована',
};

/** Можно ли поставить или снять отметку за день (п. 8.4); null — можно, иначе причина. */
export function checkBlock(versions: HabitSchedule[], date: IsoDate, today: IsoDate): CheckBlock | null {
  if (date > today) return 'future';
  if (date < addDaysIso(today, -CHECK_WINDOW_DAYS)) return 'too-old';
  const created = creationDate(versions);
  if (!created || date < created) return 'before-created';
  if (!isActiveOn(versions, date)) return 'archived';
  if (!isPlannedOn(versions, date)) return 'not-planned';
  return null;
}

/** Состояния круга (п. 8.3): выполнено, не выполнено (доступно), не запланировано, недоступно. */
export type CircleState = 'done' | 'open' | 'unplanned' | 'unavailable';

export const CIRCLE_STATE_TEXT: Record<CircleState, string> = {
  done: 'выполнено',
  open: 'не выполнено',
  unplanned: 'не запланировано',
  unavailable: 'недоступно',
};

export type Circle = { date: IsoDate; state: CircleState; block: CheckBlock | null };

/**
 * Круг дня: отметка есть — «выполнено» (даже если снять её уже нельзя);
 * день вне плана (до создания, в архиве, не выбран) — «не запланировано»; будущий или слишком старый — «недоступно».
 */
export function circleFor(versions: HabitSchedule[], date: IsoDate, today: IsoDate, checked: boolean): Circle {
  const block = checkBlock(versions, date, today);
  if (checked) return { date, state: 'done', block };
  if (!isPlannedOn(versions, date)) return { date, state: 'unplanned', block };
  if (block) return { date, state: 'unavailable', block };
  return { date, state: 'open', block: null };
}

/** Отмеченные дни привычки (неудалённые отметки). */
export function checkedDates(checks: HabitCheck[], habitId: string): Set<IsoDate> {
  const set = new Set<IsoDate>();
  for (const c of checks) if (c.habitId === habitId && c.deletedAt === null) set.add(c.date);
  return set;
}

/**
 * Цель недели для «Цель на неделю» (п. 9.3): из версии, действовавшей в понедельник (если привычки ещё не было —
 * из первой версии недели); в неполной неделе — не больше числа активных дней. null — неделя не «целевая».
 */
export function weekTarget(versions: HabitSchedule[], monday: IsoDate): number | null {
  const days = weekDates(monday);
  const v = versionOn(versions, monday) ?? versions.find((x) => x.effectiveFrom >= monday && x.effectiveFrom <= days[6]!);
  if (!v || v.type !== 'weekly_target' || v.weeklyTarget === null) return null;
  const activeDays = days.filter((d) => isActiveOn(versions, d)).length;
  if (activeDays === 0) return null;
  return Math.min(v.weeklyTarget, activeDays);
}

/** Счётчик «2 из 3» / «Цель недели выполнена» / «4 из 3» (п. 8.3). */
export function weekCounterText(done: number, target: number): string {
  if (done === target) return 'Цель недели выполнена';
  return `${done} из ${target}`;
}

/** Описание расписания для строки привычки: «Каждый день», «пн, ср, пт», «3 раза в неделю». */
export function scheduleSummary(v: HabitScheduleFields | undefined): string {
  if (!v || v.type === 'daily') return 'Каждый день';
  if (v.type === 'weekdays') {
    const names = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
    return v.weekdays.map((d) => names[d - 1]).join(', ');
  }
  const n = v.weeklyTarget ?? 0;
  return `${n} ${n === 1 ? 'раз' : n >= 2 && n <= 4 ? 'раза' : 'раз'} в неделю`;
}

/** Показывать ли привычку в блоке «Привычки на сегодня» (п. 7.1). */
export function showOnToday(versions: HabitSchedule[], checks: Set<IsoDate>, today: IsoDate): boolean {
  const v = versionOn(versions, today);
  if (!v || !v.active) return false;
  if (v.type === 'daily') return true;
  if (v.type === 'weekdays') return v.weekdays.includes(isoWeekday(today));
  // «Цель на неделю»: если цель недели ещё не достигнута или привычка уже отмечена сегодня.
  if (checks.has(today)) return true;
  const monday = mondayOf(today);
  const target = weekTarget(versions, monday);
  const done = weekDates(monday).filter((d) => checks.has(d)).length;
  return target === null || done < target;
}

/** Активные привычки по ручному порядку; при совпадении ключей — по id (п. 8.7). */
export function compareHabits(a: Habit, b: Habit): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder < b.sortOrder ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
