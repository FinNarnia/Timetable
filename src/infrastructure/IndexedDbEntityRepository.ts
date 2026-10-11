import type { Table } from 'dexie';
import type { BaseEntity, HabitCheck, IsoDate, IsoDateTime, Task, TaskMove } from '../domain/types';
import type {
  ChangeNotifier,
  Clock,
  EntityPatch,
  EntityRepository,
  IdentityProvider,
  IdGenerator,
  HabitCheckRepository,
  TaskMoveRepository,
  TaskRepository,
  ListOptions,
  NewEntity,
} from '../repositories';
import type { MoyRitmDb } from './db';

export class EntityNotFoundError extends Error {
  constructor(id: string) {
    super(`Запись ${id} не найдена`);
    this.name = 'EntityNotFoundError';
  }
}

/**
 * Базовый репозиторий IndexedDB: подставляет userId текущего профиля, ведёт rev и updatedAt,
 * скрывает мягко удалённые записи (п. 13.1, 14.3).
 */
export class IndexedDbEntityRepository<T extends BaseEntity> implements EntityRepository<T> {
  constructor(
    protected readonly db: MoyRitmDb,
    protected readonly table: Table<T, string>,
    protected readonly identity: IdentityProvider,
    protected readonly clock: Clock,
    protected readonly ids: IdGenerator,
    protected readonly notifier?: ChangeNotifier,
  ) {}

  async getById(id: string, options: ListOptions = {}): Promise<T | undefined> {
    const userId = this.identity.requireUserId();
    const row = await this.table.get(id);
    if (!row || row.userId !== userId) return undefined;
    if (row.deletedAt && !options.includeDeleted) return undefined;
    return row;
  }

  async list(options: ListOptions = {}): Promise<T[]> {
    const userId = this.identity.requireUserId();
    const rows = await this.table.where('userId').equals(userId).toArray();
    return options.includeDeleted ? rows : rows.filter((r) => r.deletedAt === null);
  }

  async create(data: NewEntity<T>): Promise<T> {
    const userId = this.identity.requireUserId();
    const now = this.clock.nowIso();
    const row = {
      ...data,
      id: data.id ?? this.ids.next(),
      userId,
      rev: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    } as T;
    await this.table.add(row);
    this.notifier?.touch(this.table.name);
    return row;
  }

  async createMany(data: NewEntity<T>[]): Promise<T[]> {
    if (data.length === 0) return [];
    const userId = this.identity.requireUserId();
    const now = this.clock.nowIso();
    const rows = data.map((d) => ({ ...d, id: d.id ?? this.ids.next(), userId, rev: 1, createdAt: now, updatedAt: now, deletedAt: null }) as T);
    await this.table.bulkAdd(rows);
    this.notifier?.touch(this.table.name);
    return rows;
  }

  async updateMany(changes: Array<{ id: string; patch: EntityPatch<T>; current?: T }>, options: ListOptions = {}): Promise<T[]> {
    if (changes.length === 0) return [];
    const userId = this.identity.requireUserId();
    const now = this.clock.nowIso();
    return this.db.transaction('rw', this.table, async () => {
      const known = changes.every((c) => c.current !== undefined);
      const current = known ? changes.map((c) => c.current) : await this.table.bulkGet(changes.map((c) => c.id));
      const next = changes.map(({ id, patch }, i) => {
        const row = current[i];
        if (!row || row.userId !== userId || (row.deletedAt && !options.includeDeleted)) throw new EntityNotFoundError(id);
        return { ...row, ...patch, id: row.id, userId: row.userId, createdAt: row.createdAt, rev: row.rev + 1, updatedAt: now } as T;
      });
      await this.table.bulkPut(next);
      this.notifier?.touch(this.table.name);
      return next;
    });
  }

  async update(id: string, patch: EntityPatch<T>, options: ListOptions = {}): Promise<T> {
    return this.mutate(id, (row) => ({ ...row, ...patch }), options.includeDeleted ?? false);
  }

  async softDelete(id: string): Promise<void> {
    await this.mutate(id, (row) => ({ ...row, deletedAt: this.clock.nowIso() }), true);
  }

  async restore(id: string): Promise<void> {
    await this.mutate(id, (row) => ({ ...row, deletedAt: null }), true);
  }

  async remove(id: string): Promise<void> {
    await this.db.transaction('rw', this.table, async () => {
      const current = await this.getById(id, { includeDeleted: true });
      if (!current) throw new EntityNotFoundError(id);
      await this.table.delete(id);
    });
    this.notifier?.touch(this.table.name);
  }

  protected async mutate(id: string, change: (row: T) => T, includeDeleted = false): Promise<T> {
    return this.db.transaction('rw', this.table, async () => {
      const current = await this.getById(id, { includeDeleted });
      if (!current) throw new EntityNotFoundError(id);
      const next: T = {
        ...change(current),
        id: current.id,
        userId: current.userId,
        createdAt: current.createdAt,
        rev: current.rev + 1,
        updatedAt: this.clock.nowIso(),
      };
      await this.table.put(next);
      this.notifier?.touch(this.table.name);
      return next;
    });
  }
}

/** Отметки привычек: выборка по дням через индексы (п. 13.10). */
export class IndexedDbHabitCheckRepository extends IndexedDbEntityRepository<HabitCheck> implements HabitCheckRepository {
  async listBetween(from: IsoDate, to: IsoDate): Promise<HabitCheck[]> {
    const userId = this.identity.requireUserId();
    const rows = await this.table.where('[userId+date]').between([userId, from], [userId, to], true, true).toArray();
    return rows.filter((r) => r.deletedAt === null);
  }

  async findByDay(habitId: string, date: IsoDate): Promise<HabitCheck | undefined> {
    const userId = this.identity.requireUserId();
    const row = await this.table.where('[habitId+date]').equals([habitId, date]).first();
    return row && row.userId === userId ? row : undefined;
  }
}

/** Задачи: выборки для отчётов по индексам (п. 9.2, 15.2). */
export class IndexedDbTaskRepository extends IndexedDbEntityRepository<Task> implements TaskRepository {
  listPlannedBetween(from: IsoDate, to: IsoDate): Promise<Task[]> {
    const userId = this.identity.requireUserId();
    return this.table.where('[userId+plannedDate]').between([userId, from], [userId, to], true, true).toArray();
  }

  idsCompletedBetween(from: IsoDateTime, to: IsoDateTime): Promise<string[]> {
    const userId = this.identity.requireUserId();
    return this.table.where('[userId+completedAt]').between([userId, from], [userId, to], true, false).primaryKeys();
  }

  async getMany(ids: string[]): Promise<Task[]> {
    const userId = this.identity.requireUserId();
    const rows = await this.table.bulkGet(ids);
    return rows.filter((r): r is Task => r !== undefined && r.userId === userId);
  }
}

/** История переносов: выборка по дню, с которого перенесли. */
export class IndexedDbTaskMoveRepository extends IndexedDbEntityRepository<TaskMove> implements TaskMoveRepository {
  listFromBetween(from: IsoDate, to: IsoDate): Promise<TaskMove[]> {
    const userId = this.identity.requireUserId();
    return this.table.where('[userId+fromDate]').between([userId, from], [userId, to], true, true).toArray();
  }
}
