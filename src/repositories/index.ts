// Интерфейсы доступа к данным и сервисов окружения — п. 14.3 ТЗ.
// Реализации живут в слое Infrastructure и подключаются в composition-root.
import type {
  BaseEntity,
  Calendar,
  Category,
  DataSet,
  Habit,
  HabitCheck,
  HabitSchedule,
  IsoDate,
  IsoDateTime,
  Profile,
  Task,
  TaskMove,
  TaskSeries,
  UserSettings,
} from '../domain/types';

/** Поля, которые репозиторий заполняет сам. */
export type SystemFields = keyof BaseEntity;
export type NewEntity<T extends BaseEntity> = Omit<T, SystemFields> & { id?: string };
export type EntityPatch<T extends BaseEntity> = Partial<Omit<T, SystemFields>>;

export type ListOptions = { includeDeleted?: boolean };

/**
 * Общий контракт репозитория сущности. Реализация сама подставляет userId текущего профиля,
 * увеличивает rev, обновляет updatedAt и по умолчанию скрывает мягко удалённые записи.
 */
export interface EntityRepository<T extends BaseEntity> {
  getById(id: string, options?: ListOptions): Promise<T | undefined>;
  list(options?: ListOptions): Promise<T[]>;
  create(data: NewEntity<T>): Promise<T>;
  /** includeDeleted — изменить и мягко удалённую запись (например, обнулить удалённую категорию). */
  update(id: string, patch: EntityPatch<T>, options?: ListOptions): Promise<T>;
  softDelete(id: string): Promise<void>;
  restore(id: string): Promise<void>;
  /**
   * Физическое удаление. Только для будущих экземпляров серии, которые пересоздаются при изменении
   * «Всю серию» (п. 6.6): у них нет истории, а уникальность seriesId + occurrenceDate учитывает и удалённые записи.
   */
  remove(id: string): Promise<void>;
  /** Пакетные операции для обслуживания дня (п. 15.2): те же правила, что у create/update, одной командой. */
  createMany(data: NewEntity<T>[]): Promise<T[]>;
  /** current — запись, прочитанная в этой же транзакции: тогда повторное чтение не нужно. */
  updateMany(changes: Array<{ id: string; patch: EntityPatch<T>; current?: T }>, options?: ListOptions): Promise<T[]>;
}

export type CalendarRepository = EntityRepository<Calendar>;
export type CategoryRepository = EntityRepository<Category>;
export interface TaskRepository extends EntityRepository<Task> {
  /** Задачи с plannedDate в [from; to], включая удалённые (для отчётов, п. 9.2) — по индексу [userId+plannedDate]. */
  listPlannedBetween(from: IsoDate, to: IsoDate): Promise<Task[]>;
  /** id задач с completedAt в [from; to), включая удалённые — только ключи индекса [userId+completedAt], без чтения записей. */
  idsCompletedBetween(from: IsoDateTime, to: IsoDateTime): Promise<string[]>;
  /** Записи по id, включая удалённые; отсутствующие пропускаются. */
  getMany(ids: string[]): Promise<Task[]>;
}
export type TaskSeriesRepository = EntityRepository<TaskSeries>;
export interface TaskMoveRepository extends EntityRepository<TaskMove> {
  /** Переносы с fromDate в [from; to] — по индексу [userId+fromDate]. */
  listFromBetween(from: IsoDate, to: IsoDate): Promise<TaskMove[]>;
}
export type HabitRepository = EntityRepository<Habit>;
export type HabitScheduleRepository = EntityRepository<HabitSchedule>;
export interface HabitCheckRepository extends EntityRepository<HabitCheck> {
  /** Неудалённые отметки за период [from; to] — по индексу [userId+date]. */
  listBetween(from: IsoDate, to: IsoDate): Promise<HabitCheck[]>;
  /** Запись за день, в том числе снятая (уникальность habitId + date, п. 13.9). */
  findByDay(habitId: string, date: IsoDate): Promise<HabitCheck | undefined>;
}

export interface ProfileRepository {
  /** В MVP профиль один (п. 4.2). */
  get(): Promise<Profile | undefined>;
  put(profile: Profile): Promise<void>;
}

export interface SettingsRepository {
  get(): Promise<UserSettings | undefined>;
  put(settings: UserSettings): Promise<void>;
}

export interface Clock {
  now(): Date;
  nowIso(): IsoDateTime;
  today(): IsoDate;
}

export interface IdentityProvider {
  /** userId текущего профиля или undefined, если профиль ещё не создан. */
  currentUserId(): string | undefined;
  /** userId текущего профиля; бросает ошибку, если профиля нет. */
  requireUserId(): string;
  setCurrentUserId(userId: string | undefined): void;
}

export interface UnitOfWork {
  /** Выполняет функцию в одной транзакции над всеми хранилищами. */
  run<R>(fn: () => Promise<R>): Promise<R>;
}

/** Низкоуровневый доступ ко всему набору данных: для резервной копии и полного удаления. */
export interface DataStore {
  readAll(): Promise<DataSet | undefined>;
  /** Атомарно заменяет все данные набором из копии. */
  replaceAll(data: DataSet): Promise<void>;
  /** Атомарно удаляет все данные. */
  clearAll(): Promise<void>;
  schemaVersion(): number;
}

export type PersistenceStatus = 'persisted' | 'not-persisted' | 'unsupported';

export interface StoragePersistence {
  status(): Promise<PersistenceStatus>;
  /** Запрашивает устойчивое хранилище, если оно ещё не выдано. */
  request(): Promise<PersistenceStatus>;
}

export type TabMessage =
  | { type: 'data-replace-started' }
  | { type: 'data-replaced' }
  | { type: 'data-replace-failed' }
  /** После каждой записи: какие сущности изменились (п. 10.3). */
  | { type: 'data-changed'; entities: string[] }
  /** Вечернее уведомление показано: внутреннее — во всех вкладках, системное — один раз (п. 10.1, 10.3). */
  | { type: 'reminder'; title: string; titles: string[]; count: number };

export interface TabChannel {
  post(message: TabMessage): void;
  subscribe(listener: (message: TabMessage) => void): () => void;
}

/** Межвкладочная блокировка (Web Locks); без поддержки API функция выполняется сразу (п. 10.3). */
export interface LockProvider {
  run<R>(name: string, fn: () => Promise<R>): Promise<R>;
}

/** Отмечает изменённые сущности; изменения рассылаются другим вкладкам. */
export interface ChangeNotifier {
  touch(entity: string): void;
}

export type NotificationPermissionStatus = 'granted' | 'default' | 'denied' | 'unsupported';

/** Системные уведомления браузера (Notification API); без API — 'unsupported' (п. 10.1, 15.3). */
export interface SystemNotifier {
  permission(): NotificationPermissionStatus;
  /** Запрос разрешения — только по действию пользователя. */
  requestPermission(): Promise<NotificationPermissionStatus>;
  /** Показывает уведомление, если разрешено; onClick — переход к задачам на завтра. */
  show(title: string, body: string, onClick: () => void): boolean;
  /** Вкладка не в фокусе — тогда системное уведомление дополняет внутреннее. */
  pageHidden(): boolean;
}

export interface IdGenerator {
  next(): string;
}

export type Repositories = {
  profile: ProfileRepository;
  settings: SettingsRepository;
  calendars: CalendarRepository;
  categories: CategoryRepository;
  tasks: TaskRepository;
  taskSeries: TaskSeriesRepository;
  taskMoves: TaskMoveRepository;
  habits: HabitRepository;
  habitSchedules: HabitScheduleRepository;
  habitChecks: HabitCheckRepository;
};
