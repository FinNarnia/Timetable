// Точка сборки: здесь локальные реализации подключаются к интерфейсам (п. 14.2).
// Облачная версия заменит реализации только в этом файле.
import { createServices, type AppDeps, type Services } from './application/services';
import type { Table } from 'dexie';
import type { BaseEntity } from './domain/types';
import type { Clock, Repositories, SystemNotifier } from './repositories';
import { MoyRitmDb, DB_NAME } from './infrastructure/db';
import {
  IndexedDbEntityRepository,
  IndexedDbHabitCheckRepository,
  IndexedDbTaskMoveRepository,
  IndexedDbTaskRepository,
} from './infrastructure/IndexedDbEntityRepository';
import {
  IndexedDbDataStore,
  IndexedDbProfileRepository,
  IndexedDbSettingsRepository,
  IndexedDbUnitOfWork,
} from './infrastructure/IndexedDbStores';
import { IndexedDbGateway } from './infrastructure/IndexedDbGateway';
import { SystemClock } from './infrastructure/SystemClock';
import {
  BroadcastTabChannel,
  BrowserStoragePersistence,
  BrowserSystemNotifier,
  LocalIdentityProvider,
  TabChangeNotifier,
  UuidV7Generator,
  WebLockProvider,
} from './infrastructure/browser';

export type BuildOptions = { dbName?: string; clock?: Clock; appVersion?: string; systemNotifier?: SystemNotifier };

export function buildDeps(options: BuildOptions = {}): AppDeps & { db: MoyRitmDb } {
  const db = new MoyRitmDb(options.dbName ?? DB_NAME);
  const identity = new LocalIdentityProvider();
  const clock = options.clock ?? new SystemClock();
  const ids = new UuidV7Generator();
  const tabs = new BroadcastTabChannel();
  const notifier = new TabChangeNotifier(tabs);
  const makeRepos = (target: MoyRitmDb): Repositories => {
    const entity = <T extends BaseEntity>(table: Table<T, string>) =>
      new IndexedDbEntityRepository<T>(target, table, identity, clock, ids, notifier);
    return {
      profile: new IndexedDbProfileRepository(target),
      settings: new IndexedDbSettingsRepository(target, identity, notifier),
      calendars: entity(target.calendars),
      categories: entity(target.categories),
      tasks: new IndexedDbTaskRepository(target, target.tasks, identity, clock, ids, notifier),
      taskSeries: entity(target.taskSeries),
      taskMoves: new IndexedDbTaskMoveRepository(target, target.taskMoves, identity, clock, ids, notifier),
      habits: entity(target.habits),
      habitSchedules: entity(target.habitSchedules),
      habitChecks: new IndexedDbHabitCheckRepository(target, target.habitChecks, identity, clock, ids, notifier),
    };
  };
  const repos = makeRepos(db);
  const maintenanceDb = new MoyRitmDb(options.dbName ?? DB_NAME, { relaxedDurability: true });

  return {
    db,
    repos,
    uow: new IndexedDbUnitOfWork(db),
    dataStore: new IndexedDbDataStore(db),
    identity,
    clock,
    ids,
    persistence: new BrowserStoragePersistence(),
    tabs,
    locks: new WebLockProvider(),
    systemNotifier: options.systemNotifier ?? new BrowserSystemNotifier(),
    maintenance: { repos: makeRepos(maintenanceDb), uow: new IndexedDbUnitOfWork(maintenanceDb) },
    storage: new IndexedDbGateway(db),
    appVersion: options.appVersion ?? __APP_VERSION__,
  };
}

export function buildServices(options: BuildOptions = {}): Services {
  return createServices(buildDeps(options));
}
