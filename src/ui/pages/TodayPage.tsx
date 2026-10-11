import { useMemo } from 'react';
import type { QuickAddTarget } from '../../application/public';
import { addDaysIso, formatLongDate, greetingFor, localDateOf } from '../../domain/dates';
import { dayProgress, emptyDraft, todayGroups, type TaskDraft } from '../../domain/tasks';
import { ofTasks, ProgressRing } from '../components/ProgressRing';
import { QuickAdd } from '../components/QuickAdd';
import { TaskGroup } from '../components/TaskGroup';
import { TodayHabits } from '../components/TodayHabits';
import { BackupBanner, TomorrowBlock } from '../components/Reminder';
import { SearchField, SearchResults, useTaskSearch } from '../components/TaskSearch';
import { useAppStore } from '../state';
import { useTaskScreen } from '../taskScreen';

/** Экран «Сегодня» (п. 7.1–7.2). */
export function TodayPage() {
  const profile = useAppStore((s) => s.profile);
  const screen = useTaskScreen();
  const { tasks, loaded, error, reload, today, now, categoryById, rowProps } = screen;
  const search = useTaskSearch(tasks, today);

  const groups = useMemo(() => todayGroups(tasks, today, localDateOf), [tasks, today]);
  const progress = useMemo(() => dayProgress(tasks, today), [tasks, today]);

  return (
    <div className="today-layout">
      <section className="hero today-hero" aria-labelledby="today-title">
        <div>
          <p className="hero-date">{formatLongDate(now)}</p>
          <h1 id="today-title" className="hero-title">
            {greetingFor(now)}, {profile?.name}
          </h1>
        </div>
        <div className="hero-progress">
          <ProgressRing done={progress.done} total={progress.total} />
          <p className="hero-caption" data-testid="progress-caption">
            {progress.total === 0
              ? 'Нет задач на сегодня'
              : progress.done === progress.total
                ? 'Все задачи на сегодня выполнены'
                : `${progress.done} ${ofTasks(progress.total)}`}
          </p>
        </div>
      </section>

      <div className="today-main">
        <BackupBanner />
        <QuickAdd
          onAdded={async (task) => {
            await reload();
            screen.createdToast(task);
          }}
          onMore={(title, target) => screen.openForm(draftForTarget(title, target, today))}
        />
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
        ) : (
          <>
            <TaskGroup
              title="Сегодня"
              tasks={groups.today}
              categoryById={categoryById}
              rowProps={rowProps}
              sortable
              empty={<p className="empty-text">На сегодня задач нет. Добавьте первую или насладитесь свободным днём.</p>}
            />
            <TaskGroup title="Без даты" tasks={groups.undated} categoryById={categoryById} rowProps={rowProps} sortable />
            <TaskGroup title="Выполнено сегодня" tasks={groups.completedToday} categoryById={categoryById} rowProps={rowProps} />
            <TomorrowBlock tasks={tasks} today={today} categoryById={categoryById} rowProps={rowProps} />
            <TodayHabits />
          </>
        )}
      </div>

      {screen.formElement}
    </div>
  );
}

export function draftForTarget(title: string, target: QuickAddTarget, today: string): TaskDraft {
  if (target === 'none') return emptyDraft({ title });
  return emptyDraft({ title, scheduleType: 'date', plannedDate: target === 'today' ? today : addDaysIso(today, 1) });
}
