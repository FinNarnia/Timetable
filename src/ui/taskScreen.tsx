import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TaskValidationError } from '../application/public';
import { autoMoveLabel } from '../domain/maintenance';
import { repeatFromSeries } from '../domain/recurrence';
import { SeriesChoiceDialog, type SeriesChoice, type SeriesChoiceRequest } from './components/SeriesChoiceDialog';
import { useLocation, useNavigate } from 'react-router-dom';
import { addDaysIso, formatIsoDate, localDateOf, toTimeOfDay } from '../domain/dates';
import { canUncomplete, draftFromTask, validateTaskDraft, type MoveDirection, type TaskDraft } from '../domain/tasks';
import type { Category, Task, TaskSeries } from '../domain/types';
import { TaskFormDialog } from './components/TaskFormDialog';
import { useNow, useRunner, useTasksData } from './hooks';
import { useAppStore, useServices } from './state';

type FormState = { open: false } | { open: true; task?: Task; series?: TaskSeries; initial: TaskDraft; version: number };

/** «Задача создана» (п. 11.3); для дня не на «Сегодня» — с указанием дня. */
export function createdText(task: Task, today: string): string {
  if (!task.plannedDate || task.plannedDate === today) return 'Задача создана';
  if (task.plannedDate === addDaysIso(today, 1)) return 'Задача создана на завтра';
  return `Задача создана на ${formatIsoDate(task.plannedDate)}`;
}

/** Состояние перехода на «Предстоящие» к конкретному дню. */
export type UpcomingLocationState = { date?: string } | null;

/**
 * Общая логика экранов со списками задач («Сегодня», «Предстоящие»):
 * данные, действия над задачей, форма, сообщения, ручная сортировка с сохранением фокуса.
 */
export function useTaskScreen() {
  const services = useServices();
  const toast = useAppStore((s) => s.toast);
  const announce = useAppStore((s) => s.announce);
  const navigate = useNavigate();
  const location = useLocation();
  const now = useNow();
  const today = services.clock.today();
  const nowTime = toTimeOfDay(now);
  const data = useTasksData();
  const { tasks, categories, series, autoMoves, reload } = data;
  const run = useRunner(reload);
  const [form, setForm] = useState<FormState>({ open: false });
  const [choice, setChoice] = useState<SeriesChoiceRequest | undefined>();
  const lastChoice = useRef<SeriesChoice | undefined>(undefined);
  const pendingFocus = useRef<{ id: string; part: string } | undefined>(undefined);
  const categoryById = useMemo(() => new Map<string, Category>(categories.map((c) => [c.id, c])), [categories]);

  // После перестановки строка задачи могла быть переставлена в DOM — возвращаем фокус на тот же элемент (п. 6.13).
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = undefined;
    const el = document.querySelector<HTMLElement>(`[data-task-id="${target.id}"] [data-focus="${target.part}"]`);
    if (el && document.activeElement !== el) el.focus();
  }, [tasks]);

  /** Диалог «Только эту задачу / Всю серию» (п. 6.6); null — пользователь передумал. */
  function askChoice(request: Omit<SeriesChoiceRequest, 'resolve'>): Promise<SeriesChoice | null> {
    return new Promise((resolve) => setChoice({ ...request, resolve }));
  }

  function formFor(task: Task, version = 0): FormState {
    const own = task.seriesId ? series.find((s) => s.id === task.seriesId) : undefined;
    return {
      open: true,
      task,
      series: own,
      initial: { ...draftFromTask(task), repeat: own ? repeatFromSeries(own) : null },
      version,
    };
  }

  function createdToast(task: Task) {
    const text = createdText(task, today);
    const date = task.plannedDate;
    if (date && date > today) {
      toast(text, {
        label: 'Открыть день',
        run: () => navigate('/upcoming', { state: { date } satisfies UpcomingLocationState }),
      });
    } else if (date === today && location.pathname !== '/') {
      toast(text, { label: 'Открыть день', run: () => navigate('/') });
    } else {
      toast(text);
    }
  }

  async function toggle(task: Task) {
    await run(() => (task.status === 'completed' ? services.tasks.uncomplete(task.id) : services.tasks.complete(task.id)));
  }

  async function duplicate(task: Task) {
    const copy = await run(() => services.tasks.duplicate(task.id));
    if (copy) toast('Копия создана');
  }

  async function remove(task: Task) {
    let mode: SeriesChoice | null = null;
    if (task.seriesId) {
      mode = await askChoice({ kind: 'delete', title: task.title });
      if (!mode) return;
    }
    const token = await run(
      () =>
        mode === 'series'
          ? services.series.deleteSeries(task.id)
          : mode === 'only'
            ? services.series.deleteInstance(task.id)
            : services.tasks.delete(task.id),
      'Не удалось удалить задачу.',
    );
    if (!token) return;
    toast(mode === 'series' ? 'Серия удалена' : 'Задача удалена', {
      label: 'Отменить',
      // Экран мог смениться, пока висело сообщение: после отмены перечитываются все открытые экраны.
      run: () =>
        void run(() => services.tasks.undoDelete(token), 'Не удалось вернуть задачу.').then(() => useAppStore.getState().bumpData()),
    });
  }

  async function move(task: Task, direction: MoveDirection) {
    const active = document.activeElement;
    const part = active?.closest(`[data-task-id="${task.id}"]`) ? active.getAttribute('data-focus') : null;
    pendingFocus.current = { id: task.id, part: part ?? 'menu' };
    const result = await run(() => services.tasks.move(task.id, direction), 'Не удалось изменить порядок.');
    if (result) announce(`Позиция ${result.position} из ${result.total}`);
  }

  async function submitForm(draft: TaskDraft, options: { force?: boolean } = {}) {
    if (!form.open) return;
    const { task } = form;
    const rev = options.force ? undefined : task?.rev;
    if (!task) {
      // Новая задача: одиночная или серия.
      if (draft.repeat) {
        const { series: created, first } = await services.series.create(draft);
        setForm({ open: false });
        await reload();
        if (first) createdToast(first);
        else toast(`Задача создана на ${formatIsoDate(created.startDate)}`);
      } else {
        const saved = await services.tasks.create(draft);
        setForm({ open: false });
        await reload();
        createdToast(saved);
      }
      return;
    }
    if (!task.seriesId) {
      // Одиночная задача; включение повторения превращает её в первый экземпляр серии (п. 6.8).
      if (draft.repeat) await services.series.enableRepeat(task.id, draft, rev);
      else await services.tasks.update(task.id, draft, rev);
      setForm({ open: false });
      await reload();
      toast('Изменения сохранены');
      return;
    }
    // Экземпляр серии: «Только эту задачу» или «Всю серию» (п. 6.6).
    if (JSON.stringify(draft) === JSON.stringify(form.initial)) {
      setForm({ open: false });
      return;
    }
    const checked = validateTaskDraft(draft, today, task.plannedDate, form.series?.startDate ?? null);
    if (!checked.ok) throw new TaskValidationError(checked.errors);
    let mode = options.force ? lastChoice.current : undefined;
    if (!mode) {
      const ruleChanged = JSON.stringify(draft.repeat) !== JSON.stringify(form.initial.repeat);
      const dateChanged = draft.plannedDate !== form.initial.plannedDate;
      const picked = await askChoice({
        kind: 'edit',
        title: task.title,
        onlyDisabled: ruleChanged ? 'Правило повторения меняется только для всей серии.' : undefined,
        seriesDisabled: dateChanged ? 'Дату можно изменить только у этой задачи.' : undefined,
      });
      if (!picked) return;
      mode = picked;
    }
    lastChoice.current = mode;
    if (mode === 'only') await services.series.updateInstance(task.id, draft, rev);
    else await services.series.updateSeries(task.id, draft, rev);
    setForm({ open: false });
    await reload();
    toast('Изменения сохранены');
  }

  /** «Загрузить новую версию» после конфликта правок (п. 10.3). */
  async function reloadForm() {
    if (!form.open || !form.task) return;
    await reload();
    const fresh = await services.tasks.require(form.task.id).catch(() => undefined);
    if (!fresh) {
      setForm({ open: false });
      toast('Задача удалена в другой вкладке');
      return;
    }
    const own = fresh.seriesId ? await services.series.get(fresh.seriesId) : undefined;
    setForm({
      open: true,
      task: fresh,
      series: own,
      initial: { ...draftFromTask(fresh), repeat: own ? repeatFromSeries(own) : null },
      version: form.version + 1,
    });
  }

  /** Выполнена в прошлый день — только просмотр и дублирование (п. 6.9, 7.4). */
  const isReadOnly = (task: Task) =>
    task.status === 'missed' || (task.status === 'completed' && !canUncomplete(task, today, localDateOf));

  const rowProps = {
    today,
    nowTime,
    onToggle: (t: Task) => void toggle(t),
    onEdit: (t: Task) => setForm(formFor(t)),
    onDuplicate: (t: Task) => void duplicate(t),
    onDelete: (t: Task) => void remove(t),
    onMove: (t: Task, d: MoveDirection) => void move(t, d),
    autoMoveLabel: (t: Task) => autoMoveLabel(t, autoMoves.get(t.id)),
  };

  const formElement = (
    <>
      {form.open && (
        <TaskFormDialog
          key={form.version}
          open
          task={form.task}
          series={form.series}
          onReload={reloadForm}
      readOnly={form.task ? isReadOnly(form.task) : false}
      initial={form.initial}
      categories={categories}
      onClose={() => setForm({ open: false })}
      onSubmit={submitForm}
      onCategoriesChanged={reload}
        />
      )}
      <SeriesChoiceDialog
        request={choice}
        onDone={(value) => {
          choice?.resolve(value);
          setChoice(undefined);
        }}
      />
    </>
  );

  return {
    ...data,
    services,
    now,
    today,
    categoryById,
    rowProps,
    isReadOnly,
    createdToast,
    openForm: (initial: TaskDraft) => setForm({ open: true, initial, version: 0 }),
    formElement,
  };
}

export type TaskScreen = ReturnType<typeof useTaskScreen>;
