import { useCallback, useEffect, useRef, useState } from 'react';
import type { HabitView } from '../application/public';
import { addDaysIso } from '../domain/dates';
import { mondayOf } from '../domain/habits';
import type { HabitCheck } from '../domain/types';
import { useAppStore, useServices } from './state';

/**
 * Привычки и отметки: с понедельника прошлой недели по конец текущей — этого хватает экрану «Привычки»
 * (текущая и прошлая неделя) и блоку на «Сегодня». Перечитывается после смены дня и изменений в других вкладках.
 */
export function useHabitsData() {
  const services = useServices();
  const dataVersion = useAppStore((s) => s.dataVersion);
  const today = services.clock.today();
  const [habits, setHabits] = useState<HabitView[]>([]);
  const [checks, setChecks] = useState<HabitCheck[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const seq = ++latest.current;
    const monday = mondayOf(today);
    try {
      const [h, c] = await Promise.all([services.habits.list(), services.habits.checksBetween(addDaysIso(monday, -7), addDaysIso(monday, 6))]);
      if (seq !== latest.current) return;
      setHabits(h);
      setChecks(c);
      setError(false);
    } catch {
      if (seq === latest.current) setError(true);
    } finally {
      if (seq === latest.current) setLoaded(true);
    }
  }, [services, today]);

  useEffect(() => {
    void reload();
  }, [reload, dataVersion]);

  return { habits, checks, loaded, error, reload, today };
}
