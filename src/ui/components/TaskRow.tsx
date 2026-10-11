import { useEffect, useId, useRef, useState } from 'react';
import { isTimePassed, PRIORITY_LABEL, type MoveDirection } from '../../domain/tasks';
import type { Category, Task } from '../../domain/types';
import { CategoryLabel } from './CategoryParts';

type Props = {
  task: Task;
  category: Category | undefined;
  today: string;
  nowTime: string;
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDuplicate: (task: Task) => void;
  onDelete: (task: Task) => void;
  /** Ручная сортировка (п. 6.13): какие направления доступны; без поля — команд нет. */
  movable?: { up: boolean; down: boolean };
  onMove?: (task: Task, direction: MoveDirection) => void;
  /** Выполнена в прошлый день: только просмотр и дублирование (п. 6.9, 7.4). */
  readOnly?: boolean;
  /** Дата результата поиска (п. 7.4). */
  dateLabel?: string;
  /** «Перенесено с ДД.ММ» / «Переносится N-й раз» (п. 6.10). */
  autoMoveLabel?: (task: Task) => string | null;
  /** Видимая подпись «Повторяется» у экземпляра серии (результаты поиска, п. 7.4). */
  repeatText?: boolean;
};

/**
 * Строка задачи: настоящий чекбокс с названием задачи в подписи (п. 15.4),
 * название открывает форму, меню — «Изменить», «Дублировать», «Удалить».
 */
export function TaskRow(props: Props) {
  const { task, category, today, nowTime, onToggle, onEdit, onDuplicate, onDelete, movable, onMove, readOnly, dateLabel } = props;
  const moved = props.autoMoveLabel?.(task) ?? null;
  const titleId = useId();
  const done = task.status === 'completed';
  const passed = isTimePassed(task, today, nowTime);
  const move = (direction: MoveDirection) => {
    if (movable && onMove && (direction === 'up' ? movable.up : movable.down)) onMove(task, direction);
  };
  return (
    <li
      className={done ? 'task task-done' : 'task'}
      data-testid="task"
      data-task-id={task.id}
      onKeyDown={(e) => {
        // Alt+↑ / Alt+↓ при фокусе на задаче (п. 6.13).
        if (!e.altKey || !movable || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        e.preventDefault();
        move(e.key === 'ArrowUp' ? 'up' : 'down');
      }}
    >
      <input
        type="checkbox"
        className="task-check"
        checked={done}
        disabled={readOnly}
        aria-labelledby={titleId}
        data-focus="check"
        onChange={() => onToggle(task)}
      />
      <div className="task-body">
        <button type="button" className="task-title" data-focus="title" onClick={() => onEdit(task)}>
          <span className="visually-hidden">{readOnly ? 'Открыть задачу: ' : 'Изменить задачу: '}</span>
          <span id={titleId}>{task.title}</span>
        </button>
        <TaskMeta task={task} category={category} passed={passed} dateLabel={dateLabel} moved={moved} repeatText={props.repeatText} />
      </div>
      <TaskMenu
        title={task.title}
        readOnly={readOnly}
        movable={movable}
        onEdit={() => onEdit(task)}
        onDuplicate={() => onDuplicate(task)}
        onDelete={() => onDelete(task)}
        onMove={move}
      />
    </li>
  );
}

function TaskMeta({
  task,
  category,
  passed,
  dateLabel,
  moved,
  repeatText,
}: {
  task: Task;
  category: Category | undefined;
  passed: boolean;
  dateLabel: string | undefined;
  moved: string | null;
  repeatText: boolean | undefined;
}) {
  const items = [];
  if (dateLabel) items.push(<span key="date" className="meta-date">{dateLabel}</span>);
  if (task.plannedTime) items.push(<span key="time" className="meta-time">{task.plannedTime}</span>);
  if (passed)
    items.push(
      <span key="passed" className="meta-passed">
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.4" />
          <path d="M12 7v5l3 2" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
        Время прошло
      </span>,
    );
  if (moved)
    items.push(
      <span key="moved" className="meta-moved">
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 12h13M12 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {moved}
      </span>,
    );
  if (task.priority !== 'normal')
    items.push(
      <span key="prio" className={`meta-priority meta-priority-${task.priority}`}>
        {task.priority === 'high' ? '↑' : '↓'} {PRIORITY_LABEL[task.priority]}
      </span>,
    );
  if (category) items.push(<CategoryLabel key="cat" category={category} />);
  if (task.seriesId)
    items.push(
      <span key="repeat" className="meta-repeat">
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M17 3l3 3-3 3M20 6H8a4 4 0 0 0-4 4v1M7 21l-3-3 3-3M4 18h12a4 4 0 0 0 4-4v-1" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {repeatText ? 'Повторяется' : <span className="visually-hidden">Повторяющаяся задача</span>}
      </span>,
    );
  if (items.length === 0) return null;
  return <div className="task-meta">{items}</div>;
}

function TaskMenu({
  title,
  readOnly,
  movable,
  onEdit,
  onDuplicate,
  onDelete,
  onMove,
}: {
  title: string;
  readOnly: boolean | undefined;
  movable: { up: boolean; down: boolean } | undefined;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMove: (direction: MoveDirection) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const run = (action: () => void) => {
    setOpen(false);
    // Фокус возвращается на кнопку меню: туда же вернётся он после закрытия формы.
    buttonRef.current?.focus();
    action();
  };

  return (
    <div
      className="task-menu"
      ref={wrapRef}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
          buttonRef.current?.focus();
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="icon-btn"
        aria-label={`Действия с задачей «${title}»`}
        aria-expanded={open}
        aria-controls={menuId}
        data-focus="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" fill="currentColor" />
          <circle cx="12" cy="12" r="1.8" fill="currentColor" />
          <circle cx="19" cy="12" r="1.8" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <ul id={menuId} className="menu">
          {readOnly ? (
            <li>
              <button type="button" className="menu-item" onClick={() => run(onEdit)} autoFocus>
                Открыть
              </button>
            </li>
          ) : (
            <li>
              <button type="button" className="menu-item" onClick={() => run(onEdit)} autoFocus>
                Изменить
              </button>
            </li>
          )}
          {movable && (
            <>
              <li>
                <button type="button" className="menu-item" disabled={!movable.up} onClick={() => run(() => onMove('up'))}>
                  Выше
                </button>
              </li>
              <li>
                <button type="button" className="menu-item" disabled={!movable.down} onClick={() => run(() => onMove('down'))}>
                  Ниже
                </button>
              </li>
            </>
          )}
          <li>
            <button type="button" className="menu-item" onClick={() => run(onDuplicate)}>
              Дублировать
            </button>
          </li>
          {!readOnly && (
            <li>
              <button type="button" className="menu-item menu-item-danger" onClick={() => run(onDelete)}>
                Удалить
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
