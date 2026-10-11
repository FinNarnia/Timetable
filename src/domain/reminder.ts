// Вечернее уведомление (п. 10.1) и напоминание о резервной копии (п. 4.3, 4.5). Чистые правила без браузерных API.
import { addDaysIso, localDateOf } from './dates';
import type { IsoDate, IsoDateTime, Task, TimeOfDay, UserSettings } from './types';

export const DEFAULT_REMINDER_TIME = '20:00';

/** Время уведомления: 18:00–23:30 с шагом 30 минут (п. 10.1). */
export const REMINDER_TIMES: TimeOfDay[] = Array.from({ length: 12 }, (_, i) => {
  const minutes = 18 * 60 + i * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${minutes % 60 === 0 ? '00' : '30'}`;
});

/** Активные задачи на завтра (одиночные и экземпляры серий), без удалённых. */
export function tomorrowTasks(tasks: Task[], today: IsoDate): Task[] {
  const tomorrow = addDaysIso(today, 1);
  return tasks.filter((t) => t.deletedAt === null && t.status === 'active' && t.plannedDate === tomorrow);
}

/**
 * Пора ли показать уведомление (п. 10.1): включено, сейчас между заданным временем и 23:59,
 * сегодня ещё не показывали и на завтра есть хотя бы одна активная задача.
 */
export function reminderDue(settings: UserSettings, now: TimeOfDay, today: IsoDate, tomorrowCount: number): boolean {
  if (!settings.eveningReminderEnabled) return false;
  if (settings.lastReminderDate === today) return false;
  if (now < settings.eveningReminderTime) return false;
  return tomorrowCount > 0;
}

/** «1 задача», «2 задачи», «5 задач», «21 задача». */
export function tasksWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'задача';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'задачи';
  return 'задач';
}

export type ReminderContent = { title: string; titles: string[]; count: number };

/** Текст уведомления: «На завтра 3 задачи» и первые 3 названия (п. 10.1). */
export function reminderContent(tasks: Task[]): ReminderContent {
  return { title: `На завтра ${tasks.length} ${tasksWord(tasks.length)}`, titles: tasks.slice(0, 3).map((t) => t.title), count: tasks.length };
}

const DAY_MS = 24 * 3600 * 1000;

/** Сколько полных суток прошло между моментами (по локальным календарным датам). */
function daysBetween(fromIso: IsoDateTime, today: IsoDate): number {
  const from = localDateOf(fromIso);
  const [y1, m1, d1] = from.split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = today.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY_MS);
}

export const BACKUP_REMINDER_DAYS = 30;
/** Без устойчивого хранилища напоминание чаще (п. 4.5). */
export const BACKUP_REMINDER_DAYS_NOT_PERSISTED = 14;
export const NEW_PROFILE_DAYS = 7;
export const BANNER_SNOOZE_DAYS = 7;

/**
 * Плашка о резервной копии на «Сегодня» (п. 4.3, 4.5): копии не было больше 30 дней (14 без устойчивого хранилища)
 * или не было никогда, а профилю больше 7 дней. Закрытая плашка не показывается 7 дней.
 */
export function backupBannerDue(
  input: { profileCreatedAt: IsoDateTime; lastExportAt: IsoDateTime | null; dismissedAt: IsoDateTime | null; persisted: boolean },
  today: IsoDate,
): 'never' | 'stale' | null {
  if (input.dismissedAt !== null && daysBetween(input.dismissedAt, today) < BANNER_SNOOZE_DAYS) return null;
  if (input.lastExportAt === null) return daysBetween(input.profileCreatedAt, today) > NEW_PROFILE_DAYS ? 'never' : null;
  const limit = input.persisted ? BACKUP_REMINDER_DAYS : BACKUP_REMINDER_DAYS_NOT_PERSISTED;
  return daysBetween(input.lastExportAt, today) > limit ? 'stale' : null;
}
