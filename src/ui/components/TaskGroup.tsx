import { useId, type ReactNode } from 'react';
import { moveNeighbor, type MoveDirection } from '../../domain/tasks';
import type { Category, Task } from '../../domain/types';
import { TaskRow } from './TaskRow';

export type RowHandlers = {
  today: string;
  nowTime: string;
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDuplicate: (task: Task) => void;
  onDelete: (task: Task) => void;
  onMove: (task: Task, direction: MoveDirection) => void;
  autoMoveLabel?: (task: Task) => string | null;
};

type Props = {
  title: string;
  tasks: Task[];
  categoryById: Map<string, Category>;
  rowProps: RowHandlers;
  /** Включить «Выше / Ниже» (только в обычном списке, не в результатах поиска). */
  sortable?: boolean;
  /** Подпись даты у строки (результаты поиска). */
  dateLabel?: (task: Task) => string;
  readOnly?: (task: Task) => boolean;
  /** id заголовка — для перехода к дню из сообщения «Задача создана». */
  headingId?: string;
  /** Показ при пустой группе; без него пустая группа не выводится. */
  empty?: ReactNode;
  /** Видимая подпись «Повторяется» (результаты поиска). */
  repeatText?: boolean;
  /** Полное число задач в группе, если показана только часть (результаты поиска дорисовываются порциями). */
  total?: number;
};

/** Группа задач с заголовком и счётчиком. */
export function TaskGroup({ title, tasks, categoryById, rowProps, sortable, dateLabel, readOnly, headingId, empty, total, repeatText }: Props) {
  const autoId = useId();
  const id = headingId ?? autoId;
  const count = total ?? tasks.length;
  if (count === 0 && !empty) return null;
  return (
    <section className="task-group" aria-labelledby={id}>
      <h2 id={id} className="group-title" tabIndex={headingId ? -1 : undefined}>
        {title} {count > 0 && <span className="group-count">{count}</span>}
      </h2>
      {count === 0 ? (
        empty
      ) : (
        <ul className="task-list">
          {tasks.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              category={t.categoryId ? categoryById.get(t.categoryId) : undefined}
              {...rowProps}
              movable={
                sortable && t.status === 'active' && !t.plannedTime
                  ? { up: moveNeighbor(tasks, t.id, 'up') !== null, down: moveNeighbor(tasks, t.id, 'down') !== null }
                  : undefined
              }
              dateLabel={dateLabel?.(t)}
              readOnly={readOnly?.(t)}
              repeatText={repeatText}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
