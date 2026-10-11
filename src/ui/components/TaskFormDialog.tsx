import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { CategoryValidationError, ConflictError, TaskValidationError } from '../../application/public';
import { defaultRepeat, REPEAT_LABEL, WEEKDAY_LABELS, type RepeatFrequency } from '../../domain/recurrence';
import { CATEGORY_COLORS } from '../../domain/categories';
import { NOTE_MAX, TITLE_MAX, type TaskDraft, type TaskDraftErrors, type TaskDraftField } from '../../domain/tasks';
import type { Category, CategoryColor, Task, TaskPriority, TaskScheduleType, TaskSeries } from '../../domain/types';
import { useServices } from '../state';
import { ColorPicker } from './CategoryParts';
import { ConfirmDialog } from './ConfirmDialog';
import { Dialog } from './Dialog';

type Props = {
  open: boolean;
  /** Задача для редактирования; без неё — создание. */
  task?: Task;
  /** Только просмотр — выполненная в прошлый день задача (п. 7.4). */
  readOnly?: boolean;
  initial: TaskDraft;
  categories: Category[];
  onClose: () => void;
  /** Серия, если задача — её экземпляр (п. 6.6): правило и первая дата. */
  series?: TaskSeries;
  /**
   * Сохранить черновик; ошибки валидации — TaskValidationError, правка в другой вкладке — ConflictError (п. 10.3).
   * force — «Сохранить мои изменения» без проверки rev.
   */
  onSubmit: (draft: TaskDraft, options?: { force?: boolean }) => Promise<void>;
  /** «Загрузить новую версию» после конфликта. */
  onReload?: () => Promise<void>;
  onCategoriesChanged: () => Promise<void>;
};

const NEW_CATEGORY = '__new__';
const FIELD_ORDER: TaskDraftField[] = ['title', 'plannedDate', 'plannedTime', 'repeatWeekdays', 'repeatUntil', 'note'];

/** Расширенная форма задачи (п. 6.7–6.8). Закрытие с несохранёнными изменениями — только после подтверждения. */
export function TaskFormDialog({
  open,
  task,
  readOnly = false,
  initial,
  categories,
  series,
  onClose,
  onSubmit,
  onReload,
  onCategoriesChanged,
}: Props) {
  const { clock } = useServices();
  const today = clock.today();
  const [draft, setDraft] = useState<TaskDraft>(initial);
  const [errors, setErrors] = useState<TaskDraftErrors>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();
  const [confirmClose, setConfirmClose] = useState(false);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [conflict, setConflict] = useState(false);
  const isInstance = Boolean(task?.seriesId);
  const ids = {
    title: useId(),
    note: useId(),
    plannedDate: useId(),
    plannedTime: useId(),
    repeat: useId(),
    repeatWeekdays: useId(),
    repeatUntil: useId(),
    category: useId(),
    form: useId(),
  };
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (open) {
      setDraft(initial);
      setErrors({});
      setFormError(undefined);
      setCreatingCategory(false);
      setConfirmClose(false);
    }
    // Черновик сбрасывается только при открытии формы.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const requestClose = () => (dirty && !readOnly ? setConfirmClose(true) : onClose());
  const set = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    if (key in errors) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  function setSchedule(type: TaskScheduleType) {
    setDraft((d) => ({
      ...d,
      scheduleType: type,
      plannedDate: type === 'none' ? null : (d.plannedDate ?? today),
      plannedTime: type === 'datetime' ? d.plannedTime : null,
      repeat: type === 'none' ? null : d.repeat,
    }));
    setErrors((e) => ({ ...e, plannedDate: undefined, plannedTime: undefined, repeatWeekdays: undefined, repeatUntil: undefined }));
  }

  function setFrequency(value: string) {
    setDraft((d) => ({
      ...d,
      // По умолчанию — день недели первой даты (у экземпляра — первой даты серии, п. 6.6).
      repeat: value
        ? { ...defaultRepeat(value as RepeatFrequency, series?.startDate ?? d.plannedDate ?? today), untilDate: d.repeat?.untilDate ?? null }
        : null,
    }));
    setErrors((e) => ({ ...e, repeatWeekdays: undefined, repeatUntil: undefined }));
  }

  function toggleWeekday(day: number) {
    setDraft((d) => {
      if (!d.repeat) return d;
      const has = d.repeat.weekdays.includes(day);
      return { ...d, repeat: { ...d.repeat, weekdays: has ? d.repeat.weekdays.filter((x) => x !== day) : [...d.repeat.weekdays, day] } };
    });
    setErrors((e) => ({ ...e, repeatWeekdays: undefined }));
  }

  async function submit(event?: FormEvent, force = false) {
    event?.preventDefault();
    setBusy(true);
    setFormError(undefined);
    try {
      await onSubmit(draft, { force });
    } catch (error) {
      if (error instanceof ConflictError) {
        setConflict(true);
      } else if (error instanceof TaskValidationError) {
        setErrors(error.errors);
        const first = FIELD_ORDER.find((f) => error.errors[f]);
        if (first) requestAnimationFrame(() => document.getElementById(ids[first])?.focus());
      } else {
        setFormError('Не удалось сохранить задачу. Попробуйте ещё раз.');
      }
    } finally {
      setBusy(false);
    }
  }

  const minDate = initial.plannedDate && initial.plannedDate < today ? initial.plannedDate : today;
  const describedBy = (field: TaskDraftField) => (errors[field] ? `${ids[field]}-error` : undefined);

  return (
    <>
      <Dialog open={open} title={readOnly ? 'Просмотр задачи' : task ? 'Изменить задачу' : 'Новая задача'} onClose={requestClose}>
        {formError && (
          <p className="notice notice-danger" role="alert">
            {formError}
          </p>
        )}
        <form id={ids.form} ref={formRef} className="task-form" onSubmit={(e) => void submit(e)} noValidate>
          {isInstance && !readOnly && (
            <p className="hint">Повторяющаяся задача: при сохранении можно изменить только её или всю серию.</p>
          )}
          {readOnly && <p className="hint">Задача выполнена в прошлый день — её можно только просмотреть или дублировать.</p>}
          <fieldset className="form-fields" disabled={readOnly}>
          <div className="field">
            <label htmlFor={ids.title}>Название</label>
            <input
              id={ids.title}
              className="input"
              value={draft.title}
              maxLength={TITLE_MAX}
              autoComplete="off"
              aria-invalid={errors.title ? true : undefined}
              aria-describedby={describedBy('title')}
              onChange={(e) => set('title', e.target.value)}
            />
            <FieldError id={`${ids.title}-error`} text={errors.title} />
          </div>

          <div className="field">
            <label htmlFor={ids.note}>Заметка</label>
            <textarea
              id={ids.note}
              className="input textarea"
              value={draft.note}
              maxLength={NOTE_MAX}
              rows={3}
              aria-invalid={errors.note ? true : undefined}
              aria-describedby={describedBy('note')}
              onChange={(e) => set('note', e.target.value)}
            />
            <FieldError id={`${ids.note}-error`} text={errors.note} />
          </div>

          <fieldset className="field">
            <legend>Срок</legend>
            <Segmented
              name={`${ids.form}-schedule`}
              value={draft.scheduleType}
              options={[
                // Экземпляр серии всегда с датой.
                ...(isInstance ? [] : ([['none', 'Без даты']] as Array<[string, string]>)),
                ['date', 'Дата'],
                ['datetime', 'Дата и время'],
              ]}
              onChange={(v) => setSchedule(v as TaskScheduleType)}
            />
            {draft.scheduleType !== 'none' && (
              <div className="date-time-row">
                <div className="field">
                  <label htmlFor={ids.plannedDate}>Дата</label>
                  <input
                    id={ids.plannedDate}
                    type="date"
                    className="input"
                    min={minDate}
                    value={draft.plannedDate ?? ''}
                    aria-invalid={errors.plannedDate ? true : undefined}
                    aria-describedby={describedBy('plannedDate')}
                    onChange={(e) => set('plannedDate', e.target.value || null)}
                  />
                  <FieldError id={`${ids.plannedDate}-error`} text={errors.plannedDate} />
                </div>
                {draft.scheduleType === 'datetime' && (
                  <div className="field">
                    <label htmlFor={ids.plannedTime}>Время</label>
                    <input
                      id={ids.plannedTime}
                      type="time"
                      className="input"
                      value={draft.plannedTime ?? ''}
                      aria-invalid={errors.plannedTime ? true : undefined}
                      aria-describedby={describedBy('plannedTime')}
                      onChange={(e) => set('plannedTime', e.target.value || null)}
                    />
                    <FieldError id={`${ids.plannedTime}-error`} text={errors.plannedTime} />
                  </div>
                )}
              </div>
            )}
          </fieldset>

          {draft.scheduleType !== 'none' && (
            <RepeatFields
              ids={ids}
              draft={draft}
              errors={errors}
              isInstance={isInstance}
              firstDate={series?.startDate ?? draft.plannedDate ?? today}
              onFrequency={setFrequency}
              onWeekday={toggleWeekday}
              onUntil={(v) => {
                setDraft((d) => (d.repeat ? { ...d, repeat: { ...d.repeat, untilDate: v || null } } : d));
                setErrors((e) => ({ ...e, repeatUntil: undefined }));
              }}
            />
          )}

          <fieldset className="field">
            <legend>Приоритет</legend>
            <Segmented
              name={`${ids.form}-priority`}
              value={draft.priority}
              options={[
                ['low', 'Низкий'],
                ['normal', 'Обычный'],
                ['high', 'Высокий'],
              ]}
              onChange={(v) => set('priority', v as TaskPriority)}
            />
          </fieldset>

          <div className="field">
            <label htmlFor={ids.category}>Категория</label>
            <select
              id={ids.category}
              className="input"
              value={creatingCategory ? NEW_CATEGORY : (draft.categoryId ?? '')}
              onChange={(e) => {
                if (e.target.value === NEW_CATEGORY) {
                  setCreatingCategory(true);
                } else {
                  setCreatingCategory(false);
                  set('categoryId', e.target.value || null);
                }
              }}
            >
              <option value="">Без категории</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value={NEW_CATEGORY}>+ Новая категория</option>
            </select>
          </div>
          {creatingCategory && !readOnly && (
            <NewCategoryInline
              onCreated={async (category) => {
                await onCategoriesChanged();
                setCreatingCategory(false);
                set('categoryId', category.id);
                requestAnimationFrame(() => document.getElementById(ids.category)?.focus());
              }}
              onCancel={() => setCreatingCategory(false)}
            />
          )}
          </fieldset>
        </form>
        <div className="button-row">
          {readOnly ? (
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Закрыть
            </button>
          ) : (
            <>
              <button type="submit" form={ids.form} className="btn btn-primary" disabled={busy}>
                Сохранить
              </button>
              <button type="button" className="btn btn-secondary" onClick={requestClose}>
                Отмена
              </button>
            </>
          )}
        </div>
      </Dialog>
      <ConfirmDialog
        open={confirmClose}
        title="Закрыть без сохранения?"
        confirmLabel="Закрыть без сохранения"
        cancelLabel="Продолжить редактирование"
        onConfirm={() => {
          setConfirmClose(false);
          onClose();
        }}
        onCancel={() => setConfirmClose(false)}
      >
        <p>Изменения в задаче не сохранятся.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={conflict}
        title="Задачу изменили в другой вкладке"
        confirmLabel="Сохранить мои изменения"
        cancelLabel="Загрузить новую версию"
        onConfirm={() => {
          setConflict(false);
          void submit(undefined, true);
        }}
        onCancel={() => {
          setConflict(false);
          void onReload?.();
        }}
      >
        <p>Пока форма была открыта, эту задачу сохранили в другой вкладке. Сохранить ваши изменения поверх или загрузить новую версию?</p>
      </ConfirmDialog>
    </>
  );
}

type RepeatIds = { repeat: string; repeatWeekdays: string; repeatUntil: string };

/** Повторение (п. 6.6): правило, дни недели, дата окончания. */
function RepeatFields({
  ids,
  draft,
  errors,
  isInstance,
  firstDate,
  onFrequency,
  onWeekday,
  onUntil,
}: {
  ids: RepeatIds;
  draft: TaskDraft;
  errors: TaskDraftErrors;
  isInstance: boolean;
  firstDate: string;
  onFrequency: (value: string) => void;
  onWeekday: (day: number) => void;
  onUntil: (value: string) => void;
}) {
  const repeat = draft.repeat;
  const monthDay = Number(firstDate.slice(8, 10));
  return (
    <div className="field repeat-fields">
      <label htmlFor={ids.repeat}>Повторение</label>
      <select id={ids.repeat} className="input" value={repeat?.frequency ?? ''} onChange={(e) => onFrequency(e.target.value)}>
        {!isInstance && <option value="">Не повторять</option>}
        {(Object.keys(REPEAT_LABEL) as RepeatFrequency[]).map((f) => (
          <option key={f} value={f}>
            {REPEAT_LABEL[f]}
          </option>
        ))}
      </select>
      {repeat?.frequency === 'weekly' && (
        <fieldset className="weekdays" aria-describedby={errors.repeatWeekdays ? `${ids.repeatWeekdays}-error` : undefined}>
          <legend className="visually-hidden">Дни недели</legend>
          {WEEKDAY_LABELS.map(([day, short, full], i) => (
            <label key={day} className="weekday">
              <input
                id={i === 0 ? ids.repeatWeekdays : undefined}
                type="checkbox"
                checked={repeat.weekdays.includes(day)}
                aria-label={full}
                onChange={() => onWeekday(day)}
              />
              <span aria-hidden="true">{short}</span>
            </label>
          ))}
        </fieldset>
      )}
      <FieldError id={`${ids.repeatWeekdays}-error`} text={errors.repeatWeekdays} />
      {repeat?.frequency === 'monthly' && (
        <p className="hint">
          Каждый месяц {monthDay} числа{monthDay > 28 ? '; если такого числа в месяце нет — в последний день месяца' : ''}.
        </p>
      )}
      {repeat && (
        <div className="field">
          <label htmlFor={ids.repeatUntil}>Дата окончания (необязательно)</label>
          <input
            id={ids.repeatUntil}
            type="date"
            className="input"
            min={firstDate}
            value={repeat.untilDate ?? ''}
            aria-invalid={errors.repeatUntil ? true : undefined}
            aria-describedby={errors.repeatUntil ? `${ids.repeatUntil}-error` : undefined}
            onChange={(e) => onUntil(e.target.value)}
          />
          <FieldError id={`${ids.repeatUntil}-error`} text={errors.repeatUntil} />
        </div>
      )}
    </div>
  );
}

function FieldError({ id, text }: { id: string; text: string | undefined }) {
  if (!text) return null;
  return (
    <p id={id} className="field-error">
      {text}
    </p>
  );
}

/** Сегментированный переключатель на радиокнопках. */
export function Segmented({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="segmented">
      {options.map(([v, label]) => (
        <label key={v} className="segment">
          <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} />
          <span>{label}</span>
        </label>
      ))}
    </div>
  );
}

/** Создание категории прямо из формы задачи (п. 6.4). */
function NewCategoryInline({ onCreated, onCancel }: { onCreated: (c: Category) => Promise<void>; onCancel: () => void }) {
  const { categories } = useServices();
  const [name, setName] = useState('');
  const [color, setColor] = useState<CategoryColor>(CATEGORY_COLORS[0]);
  const [error, setError] = useState<string | undefined>();
  const inputId = useId();
  const groupId = useId();

  async function create() {
    try {
      const category = await categories.create(name, color);
      await onCreated(category);
    } catch (e) {
      setError(e instanceof CategoryValidationError ? e.message : 'Не удалось создать категорию');
      document.getElementById(inputId)?.focus();
    }
  }

  return (
    <div className="inline-panel" role="group" aria-labelledby={groupId}>
      <p id={groupId} className="inline-panel-title">
        Новая категория
      </p>
      <div className="field">
        <label htmlFor={inputId}>Название категории</label>
        <input
          id={inputId}
          className="input"
          value={name}
          maxLength={30}
          autoFocus
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          onChange={(e) => {
            setName(e.target.value);
            setError(undefined);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void create();
            }
          }}
        />
        <FieldError id={`${inputId}-error`} text={error} />
      </div>
      <ColorPicker name={`${inputId}-color`} value={color} onChange={setColor} />
      <div className="button-row">
        <button type="button" className="btn btn-dark" onClick={() => void create()}>
          Создать категорию
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </div>
  );
}
