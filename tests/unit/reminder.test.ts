import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../src/domain/profile';
import { backupBannerDue, reminderContent, reminderDue, REMINDER_TIMES, tasksWord, tomorrowTasks } from '../../src/domain/reminder';
import type { Task } from '../../src/domain/types';

const TODAY = '2026-10-14';
const settings = { ...defaultSettings('u', '2026-10-01T09:00:00.000Z') };
const task = (id: string, plannedDate: string | null, extra: Partial<Task> = {}): Task =>
  ({ id, title: `Задача ${id}`, status: 'active', plannedDate, deletedAt: null, ...extra }) as Task;
const local = (d: string, t = '12:00') => new Date(`${d}T${t}:00`).toISOString();

describe('вечернее уведомление (п. 10.1)', () => {
  it('по умолчанию включено, 20:00; время 18:00–23:30 с шагом 30 минут', () => {
    expect(settings.eveningReminderEnabled).toBe(true);
    expect(settings.eveningReminderTime).toBe('20:00');
    expect(REMINDER_TIMES[0]).toBe('18:00');
    expect(REMINDER_TIMES.at(-1)).toBe('23:30');
    expect(REMINDER_TIMES).toHaveLength(12);
    expect(REMINDER_TIMES).toContain('20:30');
  });

  it('показ: с заданного времени до 23:59, один раз в день, если на завтра есть задачи', () => {
    expect(reminderDue(settings, '19:59', TODAY, 2)).toBe(false);
    expect(reminderDue(settings, '20:00', TODAY, 2)).toBe(true);
    expect(reminderDue(settings, '21:00', TODAY, 2)).toBe(true); // открыли позже — всё равно покажем
    expect(reminderDue(settings, '23:59', TODAY, 2)).toBe(true);
    expect(reminderDue(settings, '21:00', TODAY, 0)).toBe(false);
    expect(reminderDue({ ...settings, lastReminderDate: TODAY }, '21:00', TODAY, 2)).toBe(false);
    expect(reminderDue({ ...settings, lastReminderDate: '2026-10-13' }, '21:00', TODAY, 2)).toBe(true);
    expect(reminderDue({ ...settings, eveningReminderEnabled: false }, '21:00', TODAY, 2)).toBe(false);
    expect(reminderDue({ ...settings, eveningReminderTime: '23:30' }, '23:00', TODAY, 2)).toBe(false);
  });

  it('задачи на завтра: только активные и неудалённые, включая экземпляры серий', () => {
    const list = [
      task('a', '2026-10-15'),
      task('b', '2026-10-15', { seriesId: 's' }),
      task('c', '2026-10-15', { status: 'completed' }),
      task('d', '2026-10-15', { deletedAt: 'x' }),
      task('e', '2026-10-16'),
      task('f', null),
    ];
    expect(tomorrowTasks(list, TODAY).map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('текст: «На завтра 3 задачи» и первые 3 названия', () => {
    const list = ['1', '2', '3', '4', '5'].map((id) => task(id, '2026-10-15'));
    expect(reminderContent(list)).toEqual({ title: 'На завтра 5 задач', titles: ['Задача 1', 'Задача 2', 'Задача 3'], count: 5 });
    expect(reminderContent(list.slice(0, 1)).title).toBe('На завтра 1 задача');
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 111, 112].map(tasksWord)).toEqual([
      'задача', 'задачи', 'задачи', 'задач', 'задач', 'задач', 'задач', 'задача', 'задачи', 'задач', 'задач', 'задач',
    ]);
  });
});

describe('плашка о резервной копии (п. 4.3, 4.5)', () => {
  const base = { profileCreatedAt: local('2026-09-01'), lastExportAt: null, dismissedAt: null, persisted: true };

  it('копии не было: только если профилю больше 7 дней', () => {
    expect(backupBannerDue({ ...base, profileCreatedAt: local('2026-10-07') }, TODAY)).toBeNull(); // 7 дней
    expect(backupBannerDue({ ...base, profileCreatedAt: local('2026-10-06') }, TODAY)).toBe('never'); // 8 дней
  });

  it('копия была: больше 30 дней назад, без устойчивого хранилища — больше 14', () => {
    expect(backupBannerDue({ ...base, lastExportAt: local('2026-09-14') }, TODAY)).toBeNull(); // 30 дней
    expect(backupBannerDue({ ...base, lastExportAt: local('2026-09-13') }, TODAY)).toBe('stale'); // 31 день
    expect(backupBannerDue({ ...base, persisted: false, lastExportAt: local('2026-09-30') }, TODAY)).toBeNull(); // 14
    expect(backupBannerDue({ ...base, persisted: false, lastExportAt: local('2026-09-29') }, TODAY)).toBe('stale'); // 15
  });

  it('закрытая плашка не показывается 7 дней', () => {
    expect(backupBannerDue({ ...base, dismissedAt: local('2026-10-08', '23:00') }, TODAY)).toBeNull(); // 6 дней
    expect(backupBannerDue({ ...base, dismissedAt: local('2026-10-07') }, TODAY)).toBe('never'); // 7 дней
  });

  it('по календарным дням, а не по 24-часовым интервалам', () => {
    expect(backupBannerDue({ ...base, lastExportAt: local('2026-09-13', '23:59') }, TODAY)).toBe('stale');
  });
});
