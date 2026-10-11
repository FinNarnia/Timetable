import { useLayoutEffect, useRef } from 'react';
import { HabitCheckError, type HabitView } from '../application/public';
import type { MoveDirection } from '../domain/tasks';
import { useAppStore, useServices } from './state';

/**
 * Общие действия с привычками для экрана «Привычки» и блока на «Сегодня»: отметка, перестановка с сохранением фокуса.
 * После записи перечитываются все открытые экраны (bumpData), чтобы блок и экран не расходились.
 */
export function useHabitActions(habits: HabitView[], reload: () => Promise<void>) {
  const services = useServices();
  const toast = useAppStore((s) => s.toast);
  const announce = useAppStore((s) => s.announce);
  const setWriteError = useAppStore((s) => s.setWriteError);
  const pendingFocus = useRef<{ id: string; part: string } | undefined>(undefined);

  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = undefined;
    const el = document.querySelector<HTMLElement>(`[data-habit-id="${target.id}"] [data-focus="${target.part}"]`);
    if (el && document.activeElement !== el) el.focus();
  }, [habits]);

  async function guard<T>(op: () => Promise<T>, failText: string): Promise<T | undefined> {
    try {
      return await op();
    } catch (error) {
      if ((error as { kind?: string }).kind === 'quota') setWriteError('quota');
      else toast(failText);
      return undefined;
    } finally {
      await reload();
      useAppStore.getState().bumpData();
    }
  }

  /** Отметка; при недоступном дне — причина (п. 11.14) через onBlocked. */
  async function toggle(habitId: string, date: string, onBlocked: (text: string) => void) {
    try {
      await services.habits.toggleCheck(habitId, date);
    } catch (error) {
      if (error instanceof HabitCheckError) onBlocked(error.message);
      else if ((error as { kind?: string }).kind === 'quota') setWriteError('quota');
      else toast('Не удалось сохранить отметку. Попробуйте ещё раз.');
    }
    await reload();
    useAppStore.getState().bumpData();
  }

  async function move(habitId: string, direction: MoveDirection) {
    const active = document.activeElement;
    const part = active?.closest(`[data-habit-id="${habitId}"]`) ? active.getAttribute('data-focus') : null;
    pendingFocus.current = { id: habitId, part: part ?? 'menu' };
    const result = await guard(() => services.habits.move(habitId, direction), 'Не удалось изменить порядок.');
    if (result) announce(`Позиция ${result.position} из ${result.total}`);
  }

  return { toggle, move, guard };
}
