import { roundPercent } from '../../domain/tasks';

/** «из 1 задачи», «из 21 задачи», но «из 2 задач», «из 11 задач». */
export function ofTasks(total: number): string {
  return `из ${total} ${total % 10 === 1 && total % 100 !== 11 ? 'задачи' : 'задач'}`;
}

type Props = { done: number; total: number };

const R = 50;
const C = 2 * Math.PI * R;

/** Круговой прогресс дня (п. 7.2). Без задач — нейтральное состояние без процента. */
export function ProgressRing({ done, total }: Props) {
  const empty = total === 0;
  const percent = empty ? 0 : roundPercent(done, total);
  const label = empty ? 'Нет задач на сегодня' : `Выполнено ${done} ${ofTasks(total)}, ${percent}%`;
  return (
    <div className="ring">
      <svg width="120" height="120" viewBox="0 0 120 120" role="img" aria-label={label}>
        <circle cx="60" cy="60" r={R} className="ring-track" fill="none" strokeWidth="14" />
        {!empty && percent > 0 && (
          <circle
            cx="60"
            cy="60"
            r={R}
            className="ring-value"
            fill="none"
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={`${(C * percent) / 100} ${C}`}
            transform="rotate(-90 60 60)"
          />
        )}
      </svg>
      <div className={empty ? 'ring-label ring-label-empty' : 'ring-label'} aria-hidden="true">
        {empty ? 'Нет задач' : `${percent}%`}
      </div>
    </div>
  );
}
