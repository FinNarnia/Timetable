import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addDaysIso } from '../../domain/dates';
import { tomorrowTasks } from '../../domain/reminder';
import { compareInDay } from '../../domain/tasks';
import type { Category, Task } from '../../domain/types';
import { downloadFile, useAppStore, useServices } from '../state';
import { TaskGroup, type RowHandlers } from './TaskGroup';

/** Переход к задачам на завтра (п. 10.1): «Предстоящие», фокус на заголовке группы «Завтра». */
export function useOpenTomorrow() {
  const navigate = useNavigate();
  const services = useServices();
  return () => navigate('/upcoming', { state: { date: addDaysIso(services.clock.today(), 1) } });
}

/**
 * Внутреннее вечернее уведомление (п. 10.1): не исчезает само, объявляется через aria-live="polite",
 * фокус не перехватывает. Область aria-live есть всегда — так скринридер замечает появление текста.
 */
export function ReminderNotice() {
  const reminder = useAppStore((s) => s.reminder);
  const setReminder = useAppStore((s) => s.setReminder);
  const openTomorrow = useOpenTomorrow();
  return (
    <div aria-live="polite" className="reminder-region">
      {reminder && (
        <section className="reminder" aria-labelledby="reminder-title" data-testid="reminder">
          <div className="reminder-body">
            <h2 id="reminder-title" className="reminder-title">
              {reminder.title}
            </h2>
            <ul className="reminder-list">
              {reminder.titles.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
            {reminder.count > reminder.titles.length && <p className="hint">и ещё {reminder.count - reminder.titles.length}</p>}
          </div>
          <div className="button-row">
            <button
              type="button"
              className="btn btn-primary btn-small"
              onClick={() => {
                setReminder(undefined);
                openTomorrow();
              }}
            >
              Посмотреть
            </button>
            <button type="button" className="btn btn-secondary btn-small" onClick={() => setReminder(undefined)}>
              Закрыть
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

type TomorrowProps = { tasks: Task[]; today: string; categoryById: Map<string, Category>; rowProps: RowHandlers };

/** Сворачиваемый блок «Завтра» на «Сегодня» — до полуночи после показа уведомления (п. 10.1). */
export function TomorrowBlock({ tasks, today, categoryById, rowProps }: TomorrowProps) {
  const reminderDay = useAppStore((s) => s.reminderDay);
  const list = useMemo(() => tomorrowTasks(tasks, today).sort(compareInDay), [tasks, today]);
  if (reminderDay !== today || list.length === 0) return null;
  return (
    <details className="card tomorrow-block" data-testid="tomorrow-block">
      <summary>
        Завтра <span className="group-count">{list.length}</span>
      </summary>
      <TaskGroup title="Задачи на завтра" tasks={list} categoryById={categoryById} rowProps={rowProps} />
    </details>
  );
}

/** Ненавязчивая плашка о резервной копии на «Сегодня» (п. 4.3, 4.5). */
export function BackupBanner() {
  const services = useServices();
  const dataVersion = useAppStore((s) => s.dataVersion);
  const toast = useAppStore((s) => s.toast);
  const [kind, setKind] = useState<'never' | 'stale' | null>(null);

  useEffect(() => {
    let cancelled = false;
    services.reminder
      .backupBanner()
      .then((k) => !cancelled && setKind(k))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [services, dataVersion]);

  if (!kind) return null;

  async function save() {
    try {
      const file = await services.data.exportBackup();
      downloadFile(file.fileName, file.content);
      await services.data.markExported();
      setKind(null);
      toast('Резервная копия скачана');
    } catch {
      toast('Не удалось подготовить копию. Попробуйте ещё раз.');
    }
  }

  async function dismiss() {
    setKind(null);
    await services.reminder.dismissBackupBanner().catch(() => undefined);
  }

  return (
    <section className="notice notice-warning backup-banner" aria-labelledby="backup-banner-title" data-testid="backup-banner">
      <p id="backup-banner-title" className="notice-title">
        {kind === 'never' ? 'Резервная копия ещё не сохранялась' : 'Давно не сохраняли резервную копию'}
      </p>
      <p>Данные хранятся только в этом браузере. Сохраните копию, чтобы не потерять их.</p>
      <div className="button-row">
        <button type="button" className="btn btn-dark btn-small" onClick={() => void save()}>
          Сохранить копию
        </button>
        <button type="button" className="btn btn-secondary btn-small" onClick={() => void dismiss()}>
          Не сейчас
        </button>
      </div>
    </section>
  );
}
