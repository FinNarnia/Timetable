import type { RepeatDraft } from './recurrence';
import type { IsoDate, Task, TaskPriority, TaskScheduleType, TimeOfDay } from './types';

export const TITLE_MAX = 120;
export const NOTE_MAX = 2000;

/** Поля задачи, которые задаёт пользователь (п. 6.1–6.5). */
export type TaskDraft = {
  title: string;
  note: string;
  scheduleType: TaskScheduleType;
  plannedDate: IsoDate | null;
  plannedTime: TimeOfDay | null;
  priority: TaskPriority;
  categoryId: string | null;
  /** Повторение (п. 6.6): только для задач с датой; null — не повторять. */
  repeat: RepeatDraft | null;
};

export type TaskDraftField = 'title' | 'note' | 'plannedDate' | 'plannedTime' | 'repeatWeekdays' | 'repeatUntil';
export type TaskDraftErrors = Partial<Record<TaskDraftField, string>>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function length(s: string): number {
  return [...s].length;
}

/**
 * Проверка задачи. `previousDate` — дата до редактирования: прошедшую дату можно оставить,
 * но нельзя выбрать заново (п. 6.5). `repeatStart` — первая дата серии (при изменении всей серии);
 * по умолчанию — дата задачи. Возвращает очищенный черновик или ошибки по полям.
 */
export function validateTaskDraft(
  draft: TaskDraft,
  today: IsoDate,
  previousDate: IsoDate | null = null,
  repeatStart: IsoDate | null = null,
): { ok: true; value: TaskDraft } | { ok: false; errors: TaskDraftErrors } {
  const errors: TaskDraftErrors = {};
  const title = draft.title.trim();
  if (length(title) === 0) errors.title = 'Введите название задачи';
  else if (length(title) > TITLE_MAX) errors.title = `Название — не длиннее ${TITLE_MAX} символов`;

  if (length(draft.note) > NOTE_MAX) errors.note = `Заметка — не длиннее ${NOTE_MAX} символов`;

  let plannedDate: IsoDate | null = null;
  let plannedTime: TimeOfDay | null = null;
  if (draft.scheduleType === 'none') {
    if (draft.plannedTime) errors.plannedTime = 'Время можно указать только вместе с датой';
  } else {
    if (!draft.plannedDate || !DATE_RE.test(draft.plannedDate)) {
      errors.plannedDate = 'Выберите дату';
    } else if (draft.plannedDate < today && draft.plannedDate !== previousDate) {
      errors.plannedDate = 'Дата не может быть в прошлом';
    } else {
      plannedDate = draft.plannedDate;
    }
    if (draft.scheduleType === 'datetime') {
      if (!draft.plannedTime || !TIME_RE.test(draft.plannedTime)) errors.plannedTime = 'Укажите время';
      else plannedTime = draft.plannedTime;
    }
  }

  // Повторение (п. 6.6): от 1 до 7 дней недели; дата окончания не раньше первой даты.
  let repeat: RepeatDraft | null = null;
  if (draft.scheduleType !== 'none' && draft.repeat) {
    const r = draft.repeat;
    const weekdays = r.frequency === 'weekly' ? [...new Set(r.weekdays)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b) : [];
    if (r.frequency === 'weekly' && weekdays.length === 0) errors.repeatWeekdays = 'Выберите хотя бы один день недели';
    const first = repeatStart ?? draft.plannedDate;
    if (r.untilDate !== null && !DATE_RE.test(r.untilDate)) errors.repeatUntil = 'Выберите дату окончания';
    else if (r.untilDate !== null && first && r.untilDate < first) errors.repeatUntil = 'Дата окончания — не раньше первой даты';
    repeat = { frequency: r.frequency, weekdays, untilDate: r.untilDate };
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      title,
      note: draft.note,
      scheduleType: draft.scheduleType,
      plannedDate,
      plannedTime,
      priority: draft.priority,
      categoryId: draft.categoryId,
      repeat,
    },
  };
}

export function emptyDraft(overrides: Partial<TaskDraft> = {}): TaskDraft {
  return {
    title: '',
    note: '',
    scheduleType: 'none',
    plannedDate: null,
    plannedTime: null,
    priority: 'normal',
    categoryId: null,
    repeat: null,
    ...overrides,
  };
}

export function draftFromTask(task: Task): TaskDraft {
  return {
    title: task.title,
    note: task.note,
    scheduleType: task.scheduleType,
    plannedDate: task.plannedDate,
    plannedTime: task.plannedTime,
    priority: task.priority,
    categoryId: task.categoryId,
    repeat: null,
  };
}

/** Округление процента до целого, 0,5 — вверх (п. 9.1, 14.5). */
export function roundPercent(part: number, total: number): number {
  return Math.floor((200 * part + total) / (2 * total)); // = ⌊part·100/total + 0,5⌋ в целых числах
}

export type DayProgress = { done: number; total: number; percent: number | null };

/**
 * Круговой прогресс дня (п. 7.2): неудалённые задачи с плановой датой «сегодня»
 * в статусе active или completed. Задачи без даты и привычки не входят.
 * Без задач процент не показывается (null).
 */
export function dayProgress(tasks: Task[], today: IsoDate): DayProgress {
  const relevant = tasks.filter(
    (t) => t.deletedAt === null && t.plannedDate === today && (t.status === 'active' || t.status === 'completed'),
  );
  const done = relevant.filter((t) => t.status === 'completed').length;
  const total = relevant.length;
  return { done, total, percent: total === 0 ? null : roundPercent(done, total) };
}

/** Автоперенесённая задача (п. 6.10): хотя бы раз переносилась обслуживанием дня. */
export function isAutoMoved(task: Pick<Task, 'autoMoveCount'>): boolean {
  return task.autoMoveCount > 0;
}

/** Часть группы дня (п. 6.13): 0 — со временем, 1 — автоперенесённые без времени, 2 — остальные без времени. */
export function daySegment(task: Pick<Task, 'plannedTime' | 'autoMoveCount'>): 0 | 1 | 2 {
  if (task.plannedTime) return 0;
  return isAutoMoved(task) ? 1 : 2;
}

/**
 * Единое правило порядка в группе дня (п. 6.13): 1) со временем — хронологически;
 * 2) автоперенесённые без времени, сохраняя взаимный порядок; 3) остальные — в ручном порядке.
 */
export function compareInDay(a: Task, b: Task): number {
  const sa = daySegment(a);
  const sb = daySegment(b);
  if (sa !== sb) return sa - sb;
  if (sa === 0 && a.plannedTime !== b.plannedTime) return a.plannedTime! < b.plannedTime! ? -1 : 1;
  return compareSortOrder(a, b);
}

export function compareSortOrder(a: Task, b: Task): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder < b.sortOrder ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // совпадение ключей — по id (п. 6.13)
}

/** Локальная дата момента ISO (для completedAt). Функция преобразования передаётся извне — домен не знает о часовом поясе. */
export type ToLocalDate = (iso: string) => IsoDate;

export type TodayGroups = { today: Task[]; undated: Task[]; completedToday: Task[] };

/** Группы экрана «Сегодня» (п. 7.1). */
export function todayGroups(tasks: Task[], today: IsoDate, toLocalDate: ToLocalDate): TodayGroups {
  const alive = tasks.filter((t) => t.deletedAt === null);
  return {
    today: alive.filter((t) => t.status === 'active' && t.plannedDate === today).sort(compareInDay),
    undated: alive.filter((t) => t.status === 'active' && t.scheduleType === 'none').sort(compareSortOrder),
    completedToday: alive
      .filter((t) => t.status === 'completed' && t.completedAt !== null && toLocalDate(t.completedAt) === today)
      .sort((a, b) => (a.completedAt! < b.completedAt! ? 1 : a.completedAt! > b.completedAt! ? -1 : 0)),
  };
}

/** «Время прошло» — активная задача на сегодня, время которой уже наступило (п. 6.5). */
export function isTimePassed(task: Task, today: IsoDate, nowTime: TimeOfDay): boolean {
  return task.status === 'active' && task.plannedDate === today && task.plannedTime !== null && task.plannedTime < nowTime;
}

/** Снять отметку можно только в день выполнения (п. 6.9). */
export function canUncomplete(task: Task, today: IsoDate, toLocalDate: ToLocalDate): boolean {
  return task.status === 'completed' && task.completedAt !== null && toLocalDate(task.completedAt) === today;
}

/**
 * Изменения при выполнении (п. 6.9): одиночная задача на будущую дату получает сегодняшнюю дату;
 * экземпляр серии сохраняет свою дату; задача без даты даты не получает.
 */
export function completionPatch(task: Task, today: IsoDate, nowIso: string): Partial<Task> {
  const patch: Partial<Task> = { status: 'completed', completedAt: nowIso };
  if (task.seriesId === null && task.plannedDate !== null && task.plannedDate > today) patch.plannedDate = today;
  return patch;
}

/** Черновик копии (п. 6.11): без повторения и истории переносов; прошедшая дата заменяется сегодняшней. */
export function duplicateDraft(task: Task, today: IsoDate): TaskDraft {
  const draft = draftFromTask(task);
  if (draft.plannedDate !== null && draft.plannedDate < today) draft.plannedDate = today;
  return draft;
}

/** Ключ группы, в которой задача стоит в ручном порядке: дата или «без даты». */
export function groupKey(task: Pick<Task, 'plannedDate'>): string {
  return task.plannedDate ?? 'none';
}

/** Предельная длина ключа порядка: длиннее — группа перенумеровывается (п. 6.13). */
export const SORT_KEY_MAX = 32;

export type MoveDirection = 'up' | 'down';

/**
 * Сосед для команды «Выше» / «Ниже» (п. 6.13). group — активные задачи одной группы в порядке показа.
 * Двигать можно только задачи без времени и только внутри своей части группы
 * (автоперенесённые — среди автоперенесённых, остальные — среди остальных).
 */
export function moveNeighbor(group: Task[], id: string, direction: MoveDirection): Task | null {
  const index = group.findIndex((t) => t.id === id);
  const task = group[index];
  if (!task || task.status !== 'active' || task.plannedTime) return null;
  const neighbor = group[direction === 'up' ? index - 1 : index + 1];
  if (!neighbor || neighbor.status !== 'active' || daySegment(neighbor) !== daySegment(task)) return null;
  return neighbor;
}

/** Группу нужно перенумеровать: есть совпадающие ключи или ключ длиннее SORT_KEY_MAX (п. 6.13). */
export function needsRenumber(group: Pick<Task, 'sortOrder'>[]): boolean {
  const seen = new Set<string>();
  for (const t of group) {
    if (t.sortOrder.length > SORT_KEY_MAX || seen.has(t.sortOrder)) return true;
    seen.add(t.sortOrder);
  }
  return false;
}

export type DayGroup = { date: IsoDate; tasks: Task[] };

/** «Предстоящие» (п. 7.3): активные задачи с датой от завтра, по дням; пустые дни не показываются. */
export function upcomingGroups(tasks: Task[], today: IsoDate): DayGroup[] {
  const byDate = new Map<IsoDate, Task[]>();
  for (const t of tasks) {
    if (t.deletedAt !== null || t.status !== 'active' || t.plannedDate === null || t.plannedDate <= today) continue;
    const list = byDate.get(t.plannedDate) ?? [];
    list.push(t);
    byDate.set(t.plannedDate, list);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, list]) => ({ date, tasks: list.sort(compareInDay) }));
}

/** Сколько дней хранятся в поиске выполненные задачи (п. 7.4). */
export const SEARCH_COMPLETED_DAYS = 90;

export type SearchResult = {
  query: string;
  today: Task[];
  upcoming: Task[];
  undated: Task[];
  completed: Task[];
  total: number;
};

function compareByDate(a: Task, b: Task): number {
  if (a.plannedDate !== b.plannedDate) return (a.plannedDate ?? '') < (b.plannedDate ?? '') ? -1 : 1;
  return compareInDay(a, b);
}

/**
 * Поиск (п. 7.4): подстрока в названии без учёта регистра, «ё» = «е».
 * Область: неудалённые активные задачи (любая дата и без даты) и выполненные за последние 90 дней.
 * Группы: «Сегодня» (дата сегодня и раньше), «Предстоящие», «Без даты», «Выполненные» (последние сверху).
 * normalizeFn передаётся снаружи, чтобы запрос и названия нормализовались одной функцией.
 */
export function searchTasks(
  tasks: Task[],
  rawQuery: string,
  today: IsoDate,
  toLocalDate: ToLocalDate,
  normalizeFn: (s: string) => string,
  completedSince: IsoDate,
): SearchResult {
  const query = normalizeFn(rawQuery);
  const result: SearchResult = { query: rawQuery.trim(), today: [], upcoming: [], undated: [], completed: [], total: 0 };
  if (!query) return result;
  // Активные экземпляры одной серии — одной строкой: ближайший начиная с сегодняшнего дня (п. 7.4).
  const nearest = new Map<string, Task>();
  for (const t of tasks) {
    if (t.deletedAt !== null || t.status !== 'active' || !t.seriesId || !t.plannedDate) continue;
    if (!normalizeFn(t.title).includes(query)) continue;
    const prev = nearest.get(t.seriesId);
    const better = !prev || (t.plannedDate >= today ? prev.plannedDate! < today || t.plannedDate < prev.plannedDate! : prev.plannedDate! < today && t.plannedDate < prev.plannedDate!);
    if (better) nearest.set(t.seriesId, t);
  }
  for (const t of tasks) {
    if (t.status === 'active' && t.seriesId && nearest.get(t.seriesId) !== t) continue;
    if (t.deletedAt !== null) continue;
    if (t.status === 'completed') {
      if (t.completedAt === null || toLocalDate(t.completedAt) < completedSince) continue;
    } else if (t.status !== 'active') continue;
    if (!normalizeFn(t.title).includes(query)) continue;
    if (t.status === 'completed') result.completed.push(t);
    else if (t.plannedDate === null) result.undated.push(t);
    else if (t.plannedDate <= today) result.today.push(t);
    else result.upcoming.push(t);
  }
  result.today.sort(compareByDate);
  result.upcoming.sort(compareByDate);
  result.undated.sort(compareSortOrder);
  result.completed.sort((a, b) => (a.completedAt! < b.completedAt! ? 1 : a.completedAt! > b.completedAt! ? -1 : 0));
  result.total = result.today.length + result.upcoming.length + result.undated.length + result.completed.length;
  return result;
}

export const PRIORITY_LABEL: Record<TaskPriority, string> = { low: 'Низкий', normal: 'Обычный', high: 'Высокий' };
