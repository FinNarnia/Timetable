import type { Services } from '../application/services';
import { StorageError } from '../application/public';
import { useAppStore } from './state';

/** Обслуживание дня с замером длительности (п. 15.2): performance.measure('moy-ritm:maintenance'). */
export async function runMaintenance(services: Services): Promise<void> {
  const start = performance.now();
  try {
    await services.day.maintain();
  } catch (error) {
    if (error instanceof StorageError && error.kind === 'quota') useAppStore.getState().setWriteError('quota');
    else useAppStore.getState().toast('Не удалось обновить задачи на новый день. Попробуйте перезагрузить страницу.');
  }
  performance.measure('moy-ritm:maintenance', { start, end: performance.now() });
  useAppStore.getState().setDay(services.clock.today());
}

