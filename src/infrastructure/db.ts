import Dexie, { type Table } from 'dexie';
import type {
  Calendar,
  Category,
  Habit,
  HabitCheck,
  HabitSchedule,
  Profile,
  Task,
  TaskMove,
  TaskSeries,
  UserSettings,
} from '../domain/types';

export const DB_NAME = 'moy-ritm';

/**
 * Версии схемы IndexedDB (п. 14.4). Каждое изменение схемы — новый элемент списка
 * с полным описанием хранилищ и, при необходимости, функцией upgrade.
 * Миграции не удаляют пользовательские данные; тест на снимке каждой версии — в tests/integration.
 */
export const SCHEMA_MIGRATIONS = [
  {
    version: 1,
    stores: {
      profile: 'id',
      settings: 'userId',
      calendars: 'id, userId',
      categories: 'id, userId, [userId+normalizedName]',
      tasks: 'id, userId, [userId+plannedDate], [userId+status], &[seriesId+occurrenceDate], [userId+completedAt]',
      taskSeries: 'id, userId',
      taskMoves: 'id, userId, [userId+fromDate], [taskId+fromDate]',
      habits: 'id, userId',
      habitSchedules: 'id, userId, &[habitId+effectiveFrom]',
      habitChecks: 'id, userId, [userId+date], &[habitId+date]',
    },
  },
] as const;

export const SCHEMA_VERSION = SCHEMA_MIGRATIONS[SCHEMA_MIGRATIONS.length - 1]!.version;

export const TABLE_NAMES = Object.keys(SCHEMA_MIGRATIONS[0].stores) as Array<keyof (typeof SCHEMA_MIGRATIONS)[0]['stores']>;

export class MoyRitmDb extends Dexie {
  profile!: Table<Profile, string>;
  settings!: Table<UserSettings, string>;
  calendars!: Table<Calendar, string>;
  categories!: Table<Category, string>;
  tasks!: Table<Task, string>;
  taskSeries!: Table<TaskSeries, string>;
  taskMoves!: Table<TaskMove, string>;
  habits!: Table<Habit, string>;
  habitSchedules!: Table<HabitSchedule, string>;
  habitChecks!: Table<HabitCheck, string>;

  /**
   * relaxedDurability — отдельное подключение для обслуживания дня: Chrome не ждёт сброса на диск при фиксации.
   * Это безопасно, потому что обслуживание идемпотентно: если последняя запись потеряется при сбое питания,
   * lastMaintenanceDate потеряется вместе с ней и обслуживание выполнится заново (п. 10.2, 15.2).
   */
  constructor(name: string = DB_NAME, options: { relaxedDurability?: boolean } = {}) {
    super(name, options.relaxedDurability ? { chromeTransactionDurability: 'relaxed' } : undefined);
    for (const migration of SCHEMA_MIGRATIONS) {
      this.version(migration.version).stores(migration.stores);
    }
  }
}
