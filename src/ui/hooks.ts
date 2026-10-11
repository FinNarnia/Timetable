import { useCallback, useEffect, useRef, useState } from 'react';
import { lastAutoMoves } from '../domain/maintenance';
import type { Category, Task, TaskMove, TaskSeries } from '../domain/types';
import { useAppStore, useServices } from './state';

/** Текущее время из Clock, обновляется раз в минуту — для метки «Время прошло». */
export function useNow(intervalMs = 60_000): Date {
  const { clock } = useServices();
  const [now, setNow] = useState(() => clock.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(clock.now()), intervalMs);
    return () => clearInterval(timer);
  }, [clock, intervalMs]);
  return now;
}

export type TasksState = {
  tasks: Task[];
  categories: Category[];
  /** Неудалённые серии (подсказка о горизонте, форма экземпляра). */
  series: TaskSeries[];
  /** Последний автоперенос каждой задачи — для меток (п. 6.10). */
  autoMoves: Map<string, TaskMove>;
  loaded: boolean;
  error: boolean;
  reload: () => Promise<void>;
};

/** Задачи и категории профиля с перезагрузкой после каждой операции. */
export function useTasksData(): TasksState {
  const services = useServices();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [series, setSeries] = useState<TaskSeries[]>([]);
  const [autoMoves, setAutoMoves] = useState<Map<string, TaskMove>>(new Map());
  const dataVersion = useAppStore((s) => s.dataVersion);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  // Применяется только последняя загрузка: более старая, завершившаяся позже, не затирает свежие данные.
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const seq = ++latest.current;
    try {
      const [t, c, s, m] = await Promise.all([
        services.tasks.list(),
        services.categories.list(),
        services.series.list(),
        services.tasks.listMoves(),
      ]);
      if (seq !== latest.current) return;
      setTasks(t);
      setCategories(c);
      setSeries(s);
      setAutoMoves(lastAutoMoves(m));
      setError(false);
    } catch {
      if (seq === latest.current) setError(true);
    } finally {
      if (seq === latest.current) setLoaded(true);
    }
  }, [services]);

  // Перечитываем при открытии экрана, после обслуживания дня и при изменениях в другой вкладке (п. 10.2–10.3).
  useEffect(() => {
    void reload();
  }, [reload, dataVersion]);

  return { tasks, categories, series, autoMoves, loaded, error, reload };
}

/**
 * Выполняет операцию над данными: при ошибке показывает понятное сообщение и перечитывает данные,
 * чтобы интерфейс не остался в неверном состоянии (п. 12.4, 15.5).
 */
export function useRunner(reload: () => Promise<void>) {
  const toast = useAppStore((s) => s.toast);
  const setWriteError = useAppStore((s) => s.setWriteError);
  return useCallback(
    async <T,>(operation: () => Promise<T>, failText = 'Не удалось сохранить. Попробуйте ещё раз.'): Promise<T | undefined> => {
      try {
        const result = await operation();
        await reload();
        return result;
      } catch (error) {
        if (error instanceof Error && error.name === 'StorageError' && (error as { kind?: string }).kind === 'quota') {
          setWriteError('quota');
        } else {
          toast(failText);
        }
        await reload();
        return undefined;
      }
    },
    [reload, toast, setWriteError],
  );
}
