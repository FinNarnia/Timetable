import { useId, useState, type FormEvent } from 'react';
import { HabitValidationError } from '../../application/public';
import { HABIT_TITLE_MAX, HABIT_TYPE_LABEL, type HabitDraft, type HabitDraftErrors } from '../../domain/habits';
import { WEEKDAY_LABELS } from '../../domain/recurrence';
import type { HabitScheduleType } from '../../domain/types';
import { ConfirmDialog } from './ConfirmDialog';
import { Dialog } from './Dialog';
import { Segmented } from './TaskFormDialog';

type Props = {
  editing: boolean;
  initial: HabitDraft;
  onClose: () => void;
  onSubmit: (draft: HabitDraft) => Promise<void>;
};

/** Форма привычки (п. 8.2, 8.5). Закрытие с несохранёнными изменениями — после подтверждения. */
export function HabitFormDialog({ editing, initial, onClose, onSubmit }: Props) {
  const [draft, setDraft] = useState<HabitDraft>(initial);
  const [errors, setErrors] = useState<HabitDraftErrors>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();
  const [confirmClose, setConfirmClose] = useState(false);
  const ids = { title: useId(), weekdays: useId(), weeklyTarget: useId(), form: useId() };
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const requestClose = () => (dirty ? setConfirmClose(true) : onClose());

  function set<K extends keyof HabitDraft>(key: K, value: HabitDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFormError(undefined);
    try {
      await onSubmit(draft);
    } catch (error) {
      if (error instanceof HabitValidationError) {
        setErrors(error.errors);
        const first = (['title', 'weekdays', 'weeklyTarget'] as const).find((f) => error.errors[f]);
        if (first) requestAnimationFrame(() => document.getElementById(ids[first])?.focus());
      } else {
        setFormError('Не удалось сохранить привычку. Попробуйте ещё раз.');
      }
    } finally {
      setBusy(false);
    }
  }

  const err = (field: keyof HabitDraftErrors) =>
    errors[field] ? (
      <p id={`${ids[field]}-error`} className="field-error">
        {errors[field]}
      </p>
    ) : null;

  return (
    <>
      <Dialog open title={editing ? 'Изменить привычку' : 'Новая привычка'} onClose={requestClose}>
        {formError && (
          <p className="notice notice-danger" role="alert">
            {formError}
          </p>
        )}
        <form id={ids.form} className="task-form" onSubmit={(e) => void submit(e)} noValidate>
          <div className="field">
            <label htmlFor={ids.title}>Название</label>
            <input
              id={ids.title}
              className="input"
              value={draft.title}
              maxLength={HABIT_TITLE_MAX}
              autoComplete="off"
              aria-invalid={errors.title ? true : undefined}
              aria-describedby={errors.title ? `${ids.title}-error` : undefined}
              onChange={(e) => set('title', e.target.value)}
            />
            {err('title')}
          </div>

          <fieldset className="field">
            <legend>Тип</legend>
            <Segmented
              name={`${ids.form}-type`}
              value={draft.type}
              options={(Object.keys(HABIT_TYPE_LABEL) as HabitScheduleType[]).map((t) => [t, HABIT_TYPE_LABEL[t]])}
              onChange={(v) => set('type', v as HabitScheduleType)}
            />
          </fieldset>

          {draft.type === 'weekdays' && (
            <fieldset className="field" aria-describedby={errors.weekdays ? `${ids.weekdays}-error` : undefined}>
              <legend>Дни недели</legend>
              <div className="weekdays">
                {WEEKDAY_LABELS.map(([day, short, full], i) => (
                  <label key={day} className="weekday">
                    <input
                      id={i === 0 ? ids.weekdays : undefined}
                      type="checkbox"
                      aria-label={full}
                      checked={draft.weekdays.includes(day)}
                      onChange={() =>
                        set('weekdays', draft.weekdays.includes(day) ? draft.weekdays.filter((d) => d !== day) : [...draft.weekdays, day])
                      }
                    />
                    <span aria-hidden="true">{short}</span>
                  </label>
                ))}
              </div>
              {err('weekdays')}
            </fieldset>
          )}

          {draft.type === 'weekly_target' && (
            <div className="field">
              <label htmlFor={ids.weeklyTarget}>Сколько раз в неделю (от 1 до 6)</label>
              <input
                id={ids.weeklyTarget}
                className="input input-number"
                type="number"
                inputMode="numeric"
                min={1}
                max={6}
                step={1}
                value={Number.isNaN(draft.weeklyTarget) ? '' : draft.weeklyTarget}
                aria-invalid={errors.weeklyTarget ? true : undefined}
                aria-describedby={errors.weeklyTarget ? `${ids.weeklyTarget}-error` : undefined}
                onChange={(e) => set('weeklyTarget', e.target.value === '' ? Number.NaN : Number(e.target.value))}
              />
              {err('weeklyTarget')}
            </div>
          )}

          {editing && <p className="hint">Новое расписание действует с понедельника этой недели; прошлые недели не меняются.</p>}
        </form>
        <div className="button-row">
          <button type="submit" form={ids.form} className="btn btn-primary" disabled={busy}>
            {editing ? 'Сохранить' : 'Создать'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={requestClose}>
            Отмена
          </button>
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
        <p>Изменения в привычке не сохранятся.</p>
      </ConfirmDialog>
    </>
  );
}
