import { useId, useMemo, useState } from 'react';
import type { ArchiveToken, HabitView } from '../../application/public';
import { addDaysIso, formatWeekRange } from '../../domain/dates';
import {
  checkedDates,
  circleFor,
  draftFromHabit,
  emptyHabitDraft,
  lastActiveVersion,
  mondayOf,
  scheduleSummary,
  versionOn,
  weekCounterText,
  weekDates,
  weekTarget,
  type HabitDraft,
} from '../../domain/habits';
import type { HabitCheck } from '../../domain/types';
import { ActionMenu } from '../components/ActionMenu';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { HabitCircle } from '../components/HabitCircle';
import { HabitFormDialog } from '../components/HabitFormDialog';
import { Segmented } from '../components/TaskFormDialog';
import { useHabitActions } from '../habitActions';
import { useHabitsData } from '../habitsData';
import { useAppStore, useServices } from '../state';

const WEEKDAY_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

type FormState = { open: false } | { open: true; habit?: HabitView; initial: HabitDraft };

/** Экран «Привычки» (п. 8.3): неделя кругов у каждой привычки, прошлая неделя, архив, ручной порядок. */
export function HabitsPage() {
  const services = useServices();
  const toast = useAppStore((s) => s.toast);
  const { habits, checks, loaded, error, reload, today } = useHabitsData();
  const actions = useHabitActions(habits, reload);
  const [week, setWeek] = useState<'current' | 'previous'>('current');
  const [form, setForm] = useState<FormState>({ open: false });
  const [archiving, setArchiving] = useState<HabitView | undefined>();

  const monday = week === 'current' ? mondayOf(today) : addDaysIso(mondayOf(today), -7);
  const active = useMemo(() => habits.filter((h) => h.habit.archivedAt === null), [habits]);
  const archived = useMemo(() => habits.filter((h) => h.habit.archivedAt !== null), [habits]);

  async function submit(draft: HabitDraft) {
    if (!form.open) return;
    // Ошибки проверки уходят в форму.
    if (form.habit) await services.habits.update(form.habit.habit.id, draft);
    else await services.habits.create(draft);
    setForm({ open: false });
    await reload();
    toast(form.habit ? 'Изменения сохранены' : 'Привычка создана');
  }

  async function archive(view: HabitView) {
    setArchiving(undefined);
    const token = await actions.guard(() => services.habits.archive(view.habit.id), 'Не удалось убрать в архив.');
    if (!token) return;
    toast('Привычка убрана в архив', {
      label: 'Отменить',
      run: () => void actions.guard(() => services.habits.undoArchive(token as ArchiveToken), 'Не удалось вернуть привычку.'),
    });
  }

  async function unarchive(view: HabitView) {
    const done = await actions.guard(() => services.habits.unarchive(view.habit.id).then(() => true), 'Не удалось вернуть привычку.');
    if (done) toast('Привычка возвращена');
  }

  return (
    <div className="habits-page">
      <header className="page-header page-header-row">
        <h1 className="page-title">Привычки</h1>
        {active.length > 0 && (
          <button type="button" className="btn btn-primary" onClick={() => setForm({ open: true, initial: emptyHabitDraft() })}>
            Новая привычка
          </button>
        )}
      </header>

      {!loaded ? (
        <div className="skeleton skeleton-line" aria-label="Загрузка привычек" />
      ) : error ? (
        <div className="notice notice-danger" role="alert">
          <p>Не удалось загрузить привычки.</p>
          <button type="button" className="btn btn-secondary" onClick={() => void reload()}>
            Повторить
          </button>
        </div>
      ) : active.length === 0 ? (
        <section className="empty" aria-labelledby="habits-empty">
          <h2 id="habits-empty" className="empty-title">
            Привычек пока нет
          </h2>
          <p className="empty-text">Например: «Пить воду» каждый день, «Бассейн» по понедельникам и четвергам или «Пробежка» 3 раза в неделю.</p>
          <div className="button-row">
            <button type="button" className="btn btn-primary" onClick={() => setForm({ open: true, initial: emptyHabitDraft() })}>
              Создать первую привычку
            </button>
          </div>
        </section>
      ) : (
        <>
          <div className="habits-week-bar">
            <fieldset className="week-switch">
              <legend className="visually-hidden">Неделя</legend>
              <Segmented
                name="habits-week"
                value={week}
                options={[
                  ['current', 'Эта неделя'],
                  ['previous', 'Прошлая неделя'],
                ]}
                onChange={(v) => setWeek(v as 'current' | 'previous')}
              />
            </fieldset>
            <p className="week-range" aria-live="polite">
              {formatWeekRange(monday)}
            </p>
          </div>
          <ul className="habit-list" aria-label="Привычки">
            {active.map((view, i) => (
              <HabitCard
                key={view.habit.id}
                view={view}
                checks={checks}
                monday={monday}
                today={today}
                canUp={i > 0}
                canDown={i < active.length - 1}
                onToggle={(date, onBlocked) => void actions.toggle(view.habit.id, date, onBlocked)}
                onEdit={() => setForm({ open: true, habit: view, initial: draftFromHabit(view.habit, lastActiveVersion(view.versions)) })}
                onMove={(dir) => void actions.move(view.habit.id, dir)}
                onArchive={() => setArchiving(view)}
              />
            ))}
          </ul>
        </>
      )}

      {archived.length > 0 && (
        <details className="card archive-block">
          <summary>
            Архив <span className="group-count">{archived.length}</span>
          </summary>
          <ul className="archive-list">
            {archived.map((view) => (
              <li key={view.habit.id} className="archive-item">
                <div>
                  <p className="archive-title">{view.habit.title}</p>
                  <p className="hint">{scheduleSummary(lastActiveVersion(view.versions))}</p>
                </div>
                <button type="button" className="btn btn-secondary btn-small" aria-label={`Вернуть привычку «${view.habit.title}»`} onClick={() => void unarchive(view)}>
                  Вернуть
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {form.open && (
        <HabitFormDialog editing={Boolean(form.habit)} initial={form.initial} onClose={() => setForm({ open: false })} onSubmit={submit} />
      )}
      <ConfirmDialog
        open={archiving !== undefined}
        title="Убрать в архив?"
        confirmLabel="Убрать в архив"
        onConfirm={() => archiving && void archive(archiving)}
        onCancel={() => setArchiving(undefined)}
      >
        {archiving && (
          <p>
            «{archiving.habit.title}» исчезнет из списка и из блока на экране «Сегодня», но останется в отчётах за время, когда была
            активна. Вернуть её можно из блока «Архив» внизу экрана.
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}

type CardProps = {
  view: HabitView;
  checks: HabitCheck[];
  monday: string;
  today: string;
  canUp: boolean;
  canDown: boolean;
  onToggle: (date: string, onBlocked: (text: string) => void) => void;
  onEdit: () => void;
  onMove: (direction: 'up' | 'down') => void;
  onArchive: () => void;
};

/** Привычка: название, расписание, счётчик цели, 7 кругов недели, меню. */
function HabitCard({ view, checks, monday, today, canUp, canDown, onToggle, onEdit, onMove, onArchive }: CardProps) {
  const { habit, versions } = view;
  const [hint, setHint] = useState<string | undefined>();
  const titleId = useId();
  const hintId = useId();
  const done = useMemo(() => checkedDates(checks, habit.id), [checks, habit.id]);
  const days = weekDates(monday);
  const current = versionOn(versions, today) ?? lastActiveVersion(versions);
  const target = weekTarget(versions, monday);
  const doneInWeek = days.filter((d) => done.has(d)).length;

  return (
    <li
      className="card habit-card"
      data-habit-id={habit.id}
      onKeyDown={(e) => {
        // Alt+↑ / Alt+↓ при фокусе на привычке (п. 8.7).
        if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        e.preventDefault();
        if (e.key === 'ArrowUp' && canUp) onMove('up');
        if (e.key === 'ArrowDown' && canDown) onMove('down');
      }}
    >
      <div className="habit-head">
        <button type="button" className="habit-title" data-focus="title" onClick={onEdit}>
          <span className="visually-hidden">Изменить привычку: </span>
          <span id={titleId}>{habit.title}</span>
        </button>
        <ActionMenu
          label={`Действия с привычкой «${habit.title}»`}
          items={[
            { label: 'Изменить', onSelect: onEdit },
            { label: 'Выше', onSelect: () => onMove('up'), disabled: !canUp },
            { label: 'Ниже', onSelect: () => onMove('down'), disabled: !canDown },
            { label: 'Убрать в архив', onSelect: onArchive, danger: true },
          ]}
        />
      </div>
      <p className="habit-meta">
        <span>{scheduleSummary(current)}</span>
        {target !== null && (
          <span className={doneInWeek >= target ? 'habit-counter habit-counter-done' : 'habit-counter'} data-testid="habit-counter">
            {weekCounterText(doneInWeek, target)}
          </span>
        )}
      </p>
      <div className="habit-week" role="group" aria-label={`Отметки «${habit.title}» за неделю`} aria-describedby={hint ? hintId : undefined}>
        {days.map((date, i) => (
          <div key={date} className="habit-day">
            <span className="habit-day-label" aria-hidden="true">
              {WEEKDAY_SHORT[i]}
            </span>
            <HabitCircle
              circle={circleFor(versions, date, today, done.has(date))}
              isToday={date === today}
              onToggle={() => {
                setHint(undefined);
                onToggle(date, setHint);
              }}
              onBlocked={setHint}
            />
          </div>
        ))}
      </div>
      <p id={hintId} className="habit-hint" aria-live="polite">
        {hint ?? ''}
      </p>
    </li>
  );
}
