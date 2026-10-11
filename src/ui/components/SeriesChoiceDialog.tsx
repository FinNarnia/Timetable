import { Dialog } from './Dialog';

export type SeriesChoice = 'only' | 'series';

export type SeriesChoiceRequest = {
  kind: 'edit' | 'delete';
  title: string;
  /** Причина, по которой вариант недоступен (например, при смене правила — только вся серия). */
  onlyDisabled?: string;
  seriesDisabled?: string;
  resolve: (choice: SeriesChoice | null) => void;
};

/**
 * Выбор при изменении и удалении экземпляра серии (п. 6.6): «Только эту задачу» или «Всю серию».
 * Для удаления этот диалог и есть подтверждение удаления серии (п. 6.12).
 */
export function SeriesChoiceDialog({ request, onDone }: { request: SeriesChoiceRequest | undefined; onDone: (choice: SeriesChoice | null) => void }) {
  const edit = request?.kind === 'edit';
  const bothDisabled = Boolean(request?.onlyDisabled && request?.seriesDisabled);
  return (
    <Dialog
      open={request !== undefined}
      title={edit ? 'Изменить повторяющуюся задачу' : 'Удалить повторяющуюся задачу'}
      onClose={() => onDone(null)}
    >
      {request && (
        <>
          <p>
            «{request.title}» — повторяющаяся задача.{' '}
            {edit
              ? 'Изменить только её или всю серию? Выполненные и прошедшие задачи серии не изменятся.'
              : 'Удалить только её или всю серию? При удалении серии удалятся все её задачи начиная с сегодняшней; выполненные и прошедшие останутся в истории.'}
          </p>
          {bothDisabled && (
            <p className="notice notice-danger" role="alert">
              Дату и правило повторения нельзя изменить одновременно: сохраните сначала одно, потом другое.
            </p>
          )}
          <div className="choice-list">
            <ChoiceButton label="Только эту задачу" hint={request.onlyDisabled} onClick={() => onDone('only')} />
            <ChoiceButton
              label="Всю серию"
              hint={request.seriesDisabled}
              danger={!edit}
              onClick={() => onDone('series')}
            />
            <button type="button" className="btn btn-secondary" onClick={() => onDone(null)}>
              Отмена
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}

function ChoiceButton({ label, hint, danger, onClick }: { label: string; hint?: string; danger?: boolean; onClick: () => void }) {
  return (
    <div className="choice">
      <button
        type="button"
        className={danger ? 'btn btn-danger-solid' : 'btn btn-primary'}
        disabled={Boolean(hint)}
        onClick={onClick}
      >
        {label}
      </button>
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}
