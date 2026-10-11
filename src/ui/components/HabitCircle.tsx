import { formatWeekdayDayMonth } from '../../domain/dates';
import { CHECK_BLOCK_TEXT, CIRCLE_STATE_TEXT, type Circle } from '../../domain/habits';

type Props = {
  circle: Circle;
  isToday: boolean;
  onToggle: () => void;
  /** Недоступный день: показать причину (п. 11.14). */
  onBlocked: (text: string) => void;
};

/**
 * Круг отметки привычки (п. 8.3): 32 × 32 px, четыре состояния отличаются не только цветом —
 * галочка, сплошной контур, пунктир, заливка без контура. aria-label: «Вторник, 14 октября: выполнено».
 * Недоступный круг остаётся фокусируемым (aria-disabled) и по нажатию объясняет причину.
 */
export function HabitCircle({ circle, isToday, onToggle, onBlocked }: Props) {
  const { state, block, date } = circle;
  const label = `${formatWeekdayDayMonth(date)}: ${CIRCLE_STATE_TEXT[state]}`;
  const blocked = block !== null;
  const reason = block ? CHECK_BLOCK_TEXT[block] : undefined;
  return (
    <button
      type="button"
      className={`habit-circle habit-circle-${state}${isToday ? ' habit-circle-today' : ''}`}
      aria-label={label}
      aria-pressed={state === 'done'}
      aria-disabled={blocked || undefined}
      title={reason}
      data-date={date}
      onClick={() => (blocked ? onBlocked(reason!) : onToggle())}
    >
      {state === 'done' && (
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {state === 'unavailable' && (
        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 12h12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}
