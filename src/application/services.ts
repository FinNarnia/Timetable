import { defaultSettings, makeProfile, PERSONAL_CALENDAR_NAME, validateProfileName } from '../domain/profile';
import type { DataSet, Profile } from '../domain/types';
import type {
  Clock,
  DataStore,
  IdentityProvider,
  IdGenerator,
  LockProvider,
  SystemNotifier,
  PersistenceStatus,
  Repositories,
  StoragePersistence,
  TabChannel,
  TabMessage,
  UnitOfWork,
} from '../repositories';
import type { StorageGateway } from '../repositories/errors';
import { BACKUP_FORMAT, type BackupFile } from './backup/schema';
import { BackupParser } from './backup/BackupParser';
import type { BackupParseResult } from './backup/parseBackup';
import { DayService } from './day';
import { HabitService } from './habits';
import { ReminderService } from './reminder';
import { ReportService } from './reports';
import { SeriesService } from './series';
import { CategoryService, TaskService } from './tasks';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export type AppDeps = {
  repos: Repositories;
  uow: UnitOfWork;
  dataStore: DataStore;
  identity: IdentityProvider;
  clock: Clock;
  ids: IdGenerator;
  persistence: StoragePersistence;
  tabs: TabChannel;
  locks: LockProvider;
  /** Системные уведомления браузера (п. 10.1). */
  systemNotifier: SystemNotifier;
  /** Подключение для обслуживания дня (облегчённая фиксация); без него используется основное. */
  maintenance?: { repos: Repositories; uow: UnitOfWork };
  storage: StorageGateway;
  appVersion: string;
};

/** Профиль: запуск, первый запуск, переименование (п. 4.1–4.2, 10.4). */
export class ProfileService {
  constructor(private readonly d: AppDeps) {}

  /** Открывает хранилище и загружает профиль. undefined — первый запуск. */
  async start(): Promise<Profile | undefined> {
    await this.d.storage.open();
    const profile = await this.d.repos.profile.get();
    this.d.identity.setCurrentUserId(profile?.id);
    return profile;
  }

  async create(rawName: string): Promise<Profile> {
    const name = validateProfileName(rawName);
    if (!name.ok) throw new ValidationError(name.error);
    const now = this.d.clock.nowIso();
    const profile = makeProfile(this.d.ids.next(), name.value, now);
    this.d.identity.setCurrentUserId(profile.id);
    try {
      await this.d.uow.run(async () => {
        await this.d.repos.profile.put(profile);
        await this.d.repos.settings.put(defaultSettings(profile.id, now));
        await this.d.repos.calendars.create({ name: PERSONAL_CALENDAR_NAME, kind: 'personal' });
      });
    } catch (error) {
      this.d.identity.setCurrentUserId(undefined);
      throw error;
    }
    return profile;
  }

  async rename(rawName: string): Promise<Profile> {
    const name = validateProfileName(rawName);
    if (!name.ok) throw new ValidationError(name.error);
    const current = await this.d.repos.profile.get();
    if (!current) throw new Error('Профиль не найден');
    const next = { ...current, name: name.value, updatedAt: this.d.clock.nowIso() };
    await this.d.repos.profile.put(next);
    return next;
  }
}

/** Резервная копия, устойчивое хранилище, удаление всех данных (п. 4.3–4.6). */
export class DataService {
  private readonly parser: BackupParser;

  constructor(private readonly d: AppDeps) {
    this.parser = new BackupParser(d.dataStore.schemaVersion());
  }

  async exportBackup(): Promise<{ fileName: string; content: string }> {
    const data = await this.d.dataStore.readAll();
    if (!data) throw new Error('Нет данных для копии');
    const file: BackupFile = {
      format: BACKUP_FORMAT,
      schemaVersion: this.d.dataStore.schemaVersion(),
      appVersion: this.d.appVersion,
      exportedAt: this.d.clock.nowIso(),
      data,
    };
    const content = JSON.stringify(file);
    return { fileName: `moy-ritm-${this.d.clock.today()}.json`, content };
  }

  currentSettings() {
    return this.d.repos.settings.get();
  }

  /** Отмечает, что копия скачана (для напоминания о копии, п. 4.3). */
  async markExported(): Promise<void> {
    const settings = await this.d.repos.settings.get();
    if (!settings) return;
    const now = this.d.clock.nowIso();
    await this.d.repos.settings.put({ ...settings, lastExportAt: now, updatedAt: now });
  }

  /** Проверка файла: размер, формат, схема, согласованность. Ничего не пишет. */
  checkBackup(file: Blob, signal?: AbortSignal): Promise<BackupParseResult> {
    return this.parser.parse(file, signal);
  }

  /**
   * Заменяет все данные данными из копии одной транзакцией. Текущим становится профиль из файла.
   * Другие вкладки блокируют редактирование на время записи и затем перезагружаются (п. 4.4, 10.3).
   */
  async importBackup(data: DataSet): Promise<Profile> {
    this.d.tabs.post({ type: 'data-replace-started' });
    try {
      await this.d.dataStore.replaceAll(data);
    } catch (error) {
      this.d.tabs.post({ type: 'data-replace-failed' });
      throw error;
    }
    this.d.identity.setCurrentUserId(data.profile.id);
    this.d.tabs.post({ type: 'data-replaced' });
    return data.profile;
  }

  async deleteAllData(): Promise<void> {
    this.d.tabs.post({ type: 'data-replace-started' });
    try {
      await this.d.dataStore.clearAll();
    } catch (error) {
      this.d.tabs.post({ type: 'data-replace-failed' });
      throw error;
    }
    this.d.identity.setCurrentUserId(undefined);
    this.d.tabs.post({ type: 'data-replaced' });
  }

  persistenceStatus(): Promise<PersistenceStatus> {
    return this.d.persistence.status();
  }

  requestPersistence(): Promise<PersistenceStatus> {
    return this.d.persistence.request();
  }

  /** Аварийная выгрузка базы «как есть», когда миграция не удалась (п. 12.1). */
  async exportRaw(): Promise<{ fileName: string; content: string }> {
    const raw = await this.d.storage.exportRaw();
    return { fileName: `moy-ritm-raw-${this.d.clock.today()}.json`, content: JSON.stringify(raw) };
  }

  onTabMessage(listener: (message: TabMessage) => void): () => void {
    return this.d.tabs.subscribe(listener);
  }

  onVersionChange(listener: () => void): void {
    this.d.storage.onVersionChange(listener);
  }
}

export type Services = {
  profile: ProfileService;
  data: DataService;
  tasks: TaskService;
  series: SeriesService;
  categories: CategoryService;
  day: DayService;
  habits: HabitService;
  reports: ReportService;
  reminder: ReminderService;
  clock: Clock;
  appVersion: string;
  schemaVersion: number;
};

export function createServices(deps: AppDeps): Services {
  return {
    profile: new ProfileService(deps),
    data: new DataService(deps),
    tasks: new TaskService(deps),
    series: new SeriesService(deps),
    categories: new CategoryService(deps),
    day: new DayService(deps),
    habits: new HabitService(deps),
    reports: new ReportService(deps),
    reminder: new ReminderService(deps),
    clock: deps.clock,
    appVersion: deps.appVersion,
    schemaVersion: deps.dataStore.schemaVersion(),
  };
}
