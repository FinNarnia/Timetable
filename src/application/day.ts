import { generateKeyBetween } from 'fractional-indexing';
import { localDateOf } from '../domain/dates';
import { isEmptyPlan, planMaintenance, type MaintenancePlan } from '../domain/maintenance';
import { instanceFields } from '../domain/recurrence';
import { compareSortOrder } from '../domain/tasks';
import type { IsoDate, Task } from '../domain/types';
import type { AppDeps } from './services';

export const MAINTENANCE_LOCK = 'moy-ritm:maintenance';

export type MaintenanceResult = {
  /** false — сегодня обслуживание уже выполнено (в этой или другой вкладке). */
  ran: boolean;
  missed: number;
  autoMoved: number;
  created: number;
  purged: number;
};

const NOTHING: MaintenanceResult = { ran: false, missed: 0, autoMoved: 0, created: 0, purged: 0 };

/**
 * Обслуживание дня (п. 10.2): пропуски, автоперенос, экземпляры до горизонта, очистка старых удалённых,
 * lastMaintenanceDate — всё одной транзакцией IndexedDB. Флаг проверяется и записывается в той же транзакции,
 * поэтому две вкладки не выполнят обслуживание дважды; Web Locks лишь избавляют вторую вкладку от лишней работы (п. 10.3).
 */
export class DayService {
  private readonly store: { repos: AppDeps['repos']; uow: AppDeps['uow'] };

  constructor(private readonly d: AppDeps) {
    this.store = d.maintenance ?? d;
  }

  maintain(): Promise<MaintenanceResult> {
    return this.d.locks.run(MAINTENANCE_LOCK, () => this.store.uow.run(() => this.maintainInTransaction()));
  }

  private async maintainInTransaction(): Promise<MaintenanceResult> {
    const repos = this.store.repos;
    const settings = await repos.settings.get();
    if (!settings) return NOTHING;
    const today = this.d.clock.today();
    if (settings.lastMaintenanceDate !== null && settings.lastMaintenanceDate >= today) return NOTHING;

    const [tasks, series, moves] = await Promise.all([
      repos.tasks.list({ includeDeleted: true }),
      repos.taskSeries.list({ includeDeleted: true }),
      repos.taskMoves.list({ includeDeleted: true }),
    ]);
    const plan = planMaintenance({ tasks, series, moves, today, toLocalDate: localDateOf });
    if (!isEmptyPlan(plan)) await this.apply(plan, tasks, today);
    await repos.settings.put({ ...settings, lastMaintenanceDate: today, updatedAt: this.d.clock.nowIso() });
    return {
      ran: true,
      missed: plan.missed.length,
      autoMoved: plan.autoMoves.length,
      created: plan.newInstances.length,
      purged: plan.purgeTasks.length + plan.purgeSeries.length,
    };
  }

  private async apply(plan: MaintenancePlan, tasks: Task[], today: IsoDate): Promise<void> {
    const { repos } = this.store;
    // Пустые пакеты не вызываются: ожидание «пустого» обещания внутри транзакции Dexie может закрыть её раньше времени.
    // 1. Просроченные экземпляры серий — missed (п. 6.10).
    // 2. Автоперенос одиночных задач: одна запись с последней плановой даты на сегодня, время сохраняется.
    //    Ключ порядка не меняется — автоперенесённые стоят отдельной частью группы, сохраняя взаимный порядок (п. 6.13).
    const taskChanges = [
      ...plan.missed.map((t) => ({ id: t.id, current: t, patch: { status: 'missed' as const } })),
      ...plan.autoMoves.map(({ task }) => ({ id: task.id, current: task, patch: { plannedDate: today, autoMoveCount: task.autoMoveCount + 1 } })),
    ];
    if (taskChanges.length) await repos.tasks.updateMany(taskChanges);
    const moves = plan.autoMoves
      .filter((m) => m.createMove)
      .map(({ task, fromDate }) => ({ taskId: task.id, fromDate, toDate: today, reason: 'auto' as const }));
    if (moves.length) await repos.taskMoves.createMany(moves);

    // 3. Недостающие экземпляры до горизонта — в конец своего дня.
    const lastKey = new Map<IsoDate, string | null>();
    const keyFor = (date: IsoDate) => {
      if (!lastKey.has(date)) {
        const group = tasks.filter((t) => t.deletedAt === null && t.status === 'active' && t.plannedDate === date).sort(compareSortOrder);
        lastKey.set(date, group.length ? group[group.length - 1]!.sortOrder : null);
      }
      const key = generateKeyBetween(lastKey.get(date) ?? null, null);
      lastKey.set(date, key);
      return key;
    };
    if (plan.newInstances.length) {
      await repos.tasks.createMany(plan.newInstances.map(({ series, date }) => ({ ...instanceFields(series, date), sortOrder: keyFor(date) })));
    }
    if (plan.generatedUntil.length) {
      await repos.taskSeries.updateMany(plan.generatedUntil.map(({ series, until }) => ({ id: series.id, current: series, patch: { generatedUntil: until } })));
    }

    // 4. Удалённые больше 90 дней назад: очищаются название и заметка (п. 6.12).
    if (plan.purgeTasks.length) {
      await repos.tasks.updateMany(plan.purgeTasks.map((t) => ({ id: t.id, patch: { title: '', note: '' } })), { includeDeleted: true });
    }
    if (plan.purgeSeries.length) {
      await repos.taskSeries.updateMany(plan.purgeSeries.map((s) => ({ id: s.id, patch: { title: '', note: '' } })), { includeDeleted: true });
    }
  }
}
