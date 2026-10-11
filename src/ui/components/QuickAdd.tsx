import { useId, useRef, useState, type FormEvent } from 'react';
import type { QuickAddTarget } from '../../application/public';
import type { Task } from '../../domain/types';
import { useAppStore, useServices } from '../state';
import { Segmented } from './TaskFormDialog';

type Props = {
  /** Срок по умолчанию: «Сегодня» на одноимённом экране, «Завтра» на пустых «Предстоящих» (п. 6.7, 7.3). */
  defaultTarget?: QuickAddTarget;
  onAdded: (task: Task) => Promise<void> | void;
  onMore: (title: string, target: QuickAddTarget) => void;
};

/** Быстрое добавление (п. 6.7): название и срок; поле очищается и остаётся в фокусе. */
export function QuickAdd({ defaultTarget = 'today', onAdded, onMore }: Props) {
  const services = useServices();
  const toast = useAppStore((s) => s.toast);
  const setWriteError = useAppStore((s) => s.setWriteError);
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState<QuickAddTarget>(defaultTarget);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const groupName = useId();

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      inputRef.current?.focus();
      return;
    }
    // Поле очищается сразу: если пользователь начнёт печатать следующую задачу до окончания записи,
    // набранное не пропадёт. При ошибке название возвращается в поле.
    const value = title;
    setTitle('');
    try {
      const task = await services.tasks.quickAdd(value, target);
      await onAdded(task);
    } catch (error) {
      setTitle((current) => current || value);
      if ((error as { kind?: string }).kind === 'quota') setWriteError('quota');
      else toast('Не удалось добавить задачу. Попробуйте ещё раз.');
    }
    inputRef.current?.focus();
  }

  return (
    <form className="card quick-add" onSubmit={(e) => void add(e)} aria-label="Быстрое добавление задачи">
      <div className="quick-add-row">
        <label htmlFor={inputId} className="visually-hidden">
          Новая задача
        </label>
        <input
          ref={inputRef}
          id={inputId}
          className="input quick-add-input"
          placeholder="Добавить задачу"
          value={title}
          maxLength={120}
          autoComplete="off"
          onChange={(e) => setTitle(e.target.value)}
        />
        <button type="submit" className="btn btn-primary">
          Добавить
        </button>
      </div>
      <div className="quick-add-options">
        <fieldset className="quick-add-target">
          <legend className="visually-hidden">Срок новой задачи</legend>
          <Segmented
            name={groupName}
            value={target}
            options={[
              ['today', 'Сегодня'],
              ['tomorrow', 'Завтра'],
              ['none', 'Без даты'],
            ]}
            onChange={(v) => setTarget(v as QuickAddTarget)}
          />
        </fieldset>
        <button type="button" className="btn-link" onClick={() => onMore(title, target)}>
          Подробнее…
        </button>
      </div>
    </form>
  );
}
