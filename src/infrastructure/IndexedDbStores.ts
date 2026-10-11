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

  async replaceAll(data: DataSet): Promise<void> {
    await guarded(() => this.db.transaction('rw', this.db.tables, async () => {
      await Promise.all(this.db.tables.map((t) => t.clear()));
      await this.db.profile.add(data.profile);
      await this.db.settings.add(data.settings);
      for (const name of ENTITY_COLLECTIONS) {
        await this.db.table(name).bulkAdd(data[name]);
      }
    }));
  }

  async clearAll(): Promise<void> {
    await guarded(() =>
      this.db.transaction('rw', this.db.tables, async () => {
        await Promise.all(this.db.tables.map((t) => t.clear()));
      }),
    );
  }
}
