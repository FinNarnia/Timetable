import { addDaysIso, toTimeOfDay } from '../domain/dates';
import {
  backupBannerDue,
  reminderContent,
  reminderDue,
  REMINDER_TIMES,
  tomorrowTasks,
  type ReminderContent,
} from '../domain/reminder';
import { compareInDay } from '../domain/tasks';
import type { Task, TimeOfDay, UserSettings } from '../domain/types';
import type { NotificationPermissionStatus } from '../repositories';
import type { AppDeps } from './services';

/** Вечернее уведомление, его настройки и напоминание о копии (п. 4.3, 10.1, 10.4). */
export class ReminderService {
  constructor(private readonly d: AppDeps) {}

  private async settings(): Promise<UserSettings> {
    const s = await this.d.repos.settings.get();
    if (!s) throw new Error('Настройки не найдены');
    return s;
  }

  private async patch(change: Partial<UserSettings>): Promise<UserSettings> {
    const next = { ...(await this.settings()), ...change, updatedAt: this.d.clock.nowIso() };
    await this.d.repos.settings.put(next);
    return next;
  }

  current(): Promise<UserSettings> {
    return this.settings();
  }

  setEnabled(enabled: boolean): Promise<UserSettings> {
    return this.patch({ eveningReminderEnabled: enabled });
  }

  async setTime(time: TimeOfDay): Promise<UserSettings> {
    if (!REMINDER_TIMES.includes(time)) throw new Error('Недопустимое время уведомления');
    return this.patch({ eveningReminderTime: time });
  }

  permission(): NotificationPermissionStatus {
    return this.d.systemNotifier.permission();
  }

  requestPermission(): Promise<NotificationPermissionStatus> {
    return this.d.systemNotifier.requestPermission();
  }

  /** Активные задачи на завтра в порядке дня — для уведомления и блока «Завтра». */
  async tomorrow(): Promise<Task[]> {
    const today = this.d.clock.today();
    const tomorrow = addDaysIso(today, 1);
    return tomorrowTasks(await this.d.repos.tasks.listPlannedBetween(tomorrow, tomorrow), today).sort(compareInDay);
  }

  /**
   * Проверка уведомления (п. 10.1): при запуске, раз в минуту, при focus / visibilitychange.
   * Отметка lastReminderDate ставится в той же транзакции, что и проверка, а при наличии Web Locks — ещё и под
   * блокировкой «moy-ritm:reminder»: показ ровно один раз при любом числе вкладок (п. 10.3).
   * Возвращает содержимое, если уведомление показывает эта вкладка; другим вкладкам уходит сообщение.
   */
  async check(onClick: () => void): Promise<ReminderContent | null> {
    const content = await this.d.locks.run('moy-ritm:reminder', () =>
      this.d.uow.run(async () => {
        const today = this.d.clock.today();
        const settings = await this.settings();
        if (!reminderDue(settings, toTimeOfDay(this.d.clock.now()), today, 1)) return null;
        const tasks = await this.tomorrow();
        if (!reminderDue(settings, toTimeOfDay(this.d.clock.now()), today, tasks.length)) return null;
        await this.d.repos.settings.put({ ...settings, lastReminderDate: today, updatedAt: this.d.clock.nowIso() });
        return reminderContent(tasks);
      }),
    );
    if (!content) return null;
    this.d.tabs.post({ type: 'reminder', ...content });
    // Системное — дополнительно, если вкладка не в фокусе и разрешение выдано.
    if (this.d.systemNotifier.pageHidden()) this.d.systemNotifier.show(content.title, content.titles.join('\n'), onClick);
    return content;
  }

  /** Блок «Завтра» на «Сегодня» доступен до полуночи после показа уведомления (п. 10.1). */
  async shownToday(): Promise<boolean> {
    return (await this.settings()).lastReminderDate === this.d.clock.today();
  }

  /** Плашка о резервной копии (п. 4.3, 4.5). */
  async backupBanner(): Promise<'never' | 'stale' | null> {
    const [settings, profile, persistence] = await Promise.all([this.settings(), this.d.repos.profile.get(), this.d.persistence.status()]);
    if (!profile) return null;
    return backupBannerDue(
      {
        profileCreatedAt: profile.createdAt,
        lastExportAt: settings.lastExportAt,
        dismissedAt: settings.backupBannerDismissedAt,
        persisted: persistence === 'persisted',
      },
      this.d.clock.today(),
    );
  }

  async dismissBackupBanner(): Promise<void> {
    await this.patch({ backupBannerDismissedAt: this.d.clock.nowIso() });
  }
}

