import type { DataSet, Profile, UserSettings } from '../domain/types';
import { ENTITY_COLLECTIONS } from '../domain/types';
import type { ChangeNotifier, DataStore, IdentityProvider, ProfileRepository, SettingsRepository, UnitOfWork } from '../repositories';
import { StorageError } from '../repositories/errors';
import { SCHEMA_VERSION, type MoyRitmDb } from './db';
import { classifyStorageError } from './storageErrors';

/** Ошибки IndexedDB (нехватка места и т. п.) превращаются в StorageError, остальные пробрасываются как есть. */
async function guarded<R>(fn: () => Promise<R>): Promise<R> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof StorageError) throw error;
    const kind = classifyStorageError(error);
    if (kind === 'unknown') throw error;
    throw new StorageError(kind, error);
  }
}

export class IndexedDbProfileRepository implements ProfileRepository {
  constructor(private readonly db: MoyRitmDb) {}

  async get(): Promise<Profile | undefined> {
    return this.db.profile.toCollection().first();
  }

  async put(profile: Profile): Promise<void> {
    await guarded(() => this.db.profile.put(profile));
  }
}

export class IndexedDbSettingsRepository implements SettingsRepository {
  constructor(
    private readonly db: MoyRitmDb,
    private readonly identity: IdentityProvider,
    private readonly notifier?: ChangeNotifier,
  ) {}

  async get(): Promise<UserSettings | undefined> {
    return this.db.settings.get(this.identity.requireUserId());
  }

  async put(settings: UserSettings): Promise<void> {
    await guarded(() => this.db.settings.put(settings));
    this.notifier?.touch('settings');
  }
}

export class IndexedDbUnitOfWork implements UnitOfWork {
  constructor(private readonly db: MoyRitmDb) {}

  run<R>(fn: () => Promise<R>): Promise<R> {
    return guarded(() => this.db.transaction('rw', this.db.tables, fn));
  }
}

export class IndexedDbDataStore implements DataStore {
  constructor(private readonly db: MoyRitmDb) {}

  schemaVersion(): number {
    return SCHEMA_VERSION;
  }

  async readAll(): Promise<DataSet | undefined> {
    return this.db.transaction('r', this.db.tables, async () => {
      const profile = await this.db.profile.toCollection().first();
      if (!profile) return undefined;
      const settings = await this.db.settings.get(profile.id);
      if (!settings) return undefined;
      const data = { profile, settings } as DataSet;
      for (const name of ENTITY_COLLECTIONS) {
        // Мягко удалённые записи тоже входят в копию (п. 4.3).
        (data as Record<string, unknown>)[name] = await this.db.table(name).toArray();
      }
      return data;
    });
  }

  /**
   * Одна транзакция IndexedDB напрямую, без обёрток Dexie: все запросы ставятся сразу, без ожидания каждого.
   * Для копии в 30 000 записей это заметно быстрее bulkAdd по таблицам (п. 15.2). Атомарность та же:
   * ошибка любого запроса отменяет транзакцию целиком, прежние данные остаются.
   */
  async replaceAll(data: DataSet): Promise<void> {
    await guarded(async () => {
      await this.db.open();
      const idb = this.db.backendDB();
      const names = this.db.tables.map((t) => t.name);
      await new Promise<void>((resolve, reject) => {
        const tx = idb.transaction(names, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error ?? new DOMException('Транзакция отменена', 'AbortError'));
        for (const name of names) tx.objectStore(name).clear();
        tx.objectStore('profile').add(data.profile);
        tx.objectStore('settings').add(data.settings);
        for (const name of ENTITY_COLLECTIONS) {
          const store = tx.objectStore(name);
          for (const row of data[name]) store.add(row);
        }
      });
    });
  }

  async clearAll(): Promise<void> {
    await guarded(() =>
      this.db.transaction('rw', this.db.tables, async () => {
        await Promise.all(this.db.tables.map((t) => t.clear()));
      }),
    );
  }
}
