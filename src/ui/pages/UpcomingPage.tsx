import { Fragment, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { dayLabel } from '../../domain/dates';
import { horizonEnd } from '../../domain/recurrence';
import { upcomingGroups } from '../../domain/tasks';
import { QuickAdd } from '../components/QuickAdd';
import { TaskGroup } from '../components/TaskGroup';
import { SearchField, SearchResults, useTaskSearch } from '../components/TaskSearch';
import { useTaskScreen, type UpcomingLocationState } from '../taskScreen';
import { draftForTarget } from './TodayPage';

export const dayHeadingId = (date: string) => `day-${date}`;

/** Экран «Предстоящие» (п. 7.3): активные задачи от завтра, по дням; пустые дни не показываются. */
export function UpcomingPage() {
  const screen = useTaskScreen();
  const { tasks, series, loaded, error, reload, today, categoryById, rowProps } = screen;
  const search = useTaskSearch(tasks, today);
  const groups = useMemo(() => upcomingGroups(tasks, today), [tasks, today]);
  // Подсказка о горизонте — после группы 14-го дня (п. 7.3), если есть действующие серии.
  const horizon = horizonEnd(today);
  const hasSeries = series.some((s) => s.untilDate === null || s.untilDate > today);
  const hintAfter = groups.findIndex((g) => g.date > horizon) - 1;
  const hintIndex = hintAfter >= -1 && groups.some((g) => g.date > horizon) ? hintAfter : groups.length - 1;
  const hint = <p className="horizon-hint">Повторяющиеся задачи показаны на 2 недели вперёд</p>;
  const location = useLocation();
  const navigate = useNavigate();
  const targetDate = (location.state as UpcomingLocationState)?.date;

  // Переход из сообщения «Задача создана» — к заголовку её дня (п. 11.3).
  useEffect(() => {
    if (!loaded || !targetDate) return;
    const heading = document.getElementById(dayHeadingId(targetDate));
    if (heading) {
      heading.scrollIntoView({ block: 'start' });
      heading.focus({ preventScroll: true });
    }
    navigate(location.pathname, { replace: true, state: null });
  }, [loaded, targetDate, navigate, location.pathname]);

  return (
    <div className="upcoming">
      <header className="page-header">
        <h1 className="page-title">Предстоящие</h1>
      </header>
      <SearchField query={search.query} onChange={search.setQuery} />

      {!loaded ? (
        <div className="skeleton skeleton-line" aria-label="Загрузка задач" />
      ) : error ? (
        <div className="notice notice-danger" role="alert">
          <p>Не удалось загрузить задачи.</p>
          <button type="button" className="btn btn-secondary" onClick={() => void reload()}>
            Повторить
          </button>
        </div>
      ) : search.searching ? (
        <SearchResults result={search.result} categoryById={categoryById} rowProps={rowProps} readOnly={screen.isReadOnly} />
      ) : groups.length === 0 ? (
        <>
          <section className="empty" aria-labelledby="upcoming-empty">
            <h2 id="upcoming-empty" className="empty-title">
              Здесь появятся задачи на будущие дни
            </h2>
          </section>
          <QuickAdd
            defaultTarget="tomorrow"
            onAdded={async (task) => {
              await reload();
              screen.createdToast(task);
            }}
            onMore={(title, target) => screen.openForm(draftForTarget(title, target, today))}
          />
        </>
      ) : (
        <>
          {hasSeries && hintIndex === -1 && hint}
          {groups.map((g, i) => (
            <Fragment key={g.date}>
              <TaskGroup
                headingId={dayHeadingId(g.date)}
                title={dayLabel(g.date, today)}
                tasks={g.tasks}
                categoryById={categoryById}
                rowProps={rowProps}
                sortable
              />
              {hasSeries && i === hintIndex && hint}
            </Fragment>
          ))}
        </>
      )}

      {screen.formElement}
    </div>
  );
}
