import { useId, useMemo, useState } from 'react';
import {
  checkedDates,
  circleFor,
  mondayOf,
  showOnToday,
  versionOn,
  weekCounterText,
  weekDates,
  weekTarget,
} from '../../domain/habits';
import { useHabitActions } from '../habitActions';
import { useHabitsData } from '../habitsData';
import { HabitCircle } from './HabitCircle';

/** Компактный блок «Привычки на сегодня» на главном экране (п. 7.1); отметка ставится прямо здесь. */
export function TodayHabits() {
  const { habits, checks, loaded, reload, today } = useHabitsData();
  const actions = useHabitActions(habits, reload);
  const [hint, setHint] = useState<{ id: string; text: string } | undefined>();
  const headingId = useId();
  const monday = mondayOf(today);
  const items = useMemo(
    () =>
      habits
        .filter((h) => h.habit.archivedAt === null)
        .map((view) => ({ view, done: checkedDates(checks, view.habit.id) }))
        .filter(({ view, done }) => showOnToday(view.versions, done, today)),
    [habits, checks, today],
  );
  if (!loaded || items.length === 0) return null;

  return (
    <section className="task-group today-habits" aria-labelledby={headingId}>
      <h2 id={headingId} className="group-title">
        Привычки на сегодня <span className="group-count">{items.length}</span>
      </h2>
      <ul className="card today-habit-list">
        {items.map(({ view, done }) => {
          const target = versionOn(view.versions, today)?.type === 'weekly_target' ? weekTarget(view.versions, monday) : null;
          const count = weekDates(monday).filter((d) => done.has(d)).length;
          return (
            <li key={view.habit.id} className="today-habit" data-habit-id={view.habit.id}>
              <HabitCircle
                circle={circleFor(view.versions, today, today, done.has(today))}
                isToday={false}
                onToggle={() => void actions.toggle(view.habit.id, today, (text) => setHint({ id: view.habit.id, text }))}
                onBlocked={(text) => setHint({ id: view.habit.id, text })}
              />
              <div className="today-habit-body">
                <span className="today-habit-title">{view.habit.title}</span>
                {target !== null && (
                  <span className="hint" data-testid="habit-counter">
                    {weekCounterText(count, target)}
                  </span>
                )}
                {hint?.id === view.habit.id && <span className="habit-hint">{hint.text}</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
