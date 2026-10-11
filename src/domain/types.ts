// Логическая модель данных — раздел 13 ТЗ.
// Даты без времени: 'YYYY-MM-DD' (локальный пояс); моменты: ISO 8601 UTC; время дня: 'HH:MM'.

export type IsoDate = string; // YYYY-MM-DD
export type IsoDateTime = string; // 2026-10-09T17:30:00.000Z
export type TimeOfDay = string; // HH:MM

export type BaseEntity = {
  id: string;
  userId: string;
  rev: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  deletedAt: IsoDateTime | null;
};

export type Profile = {
  id: string; // = userId
  name: string; // 2–50
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type UserSettings = {
  userId: string;
  locale: 'ru-RU';
  weekStartsOn: 1;
  eveningReminderEnabled: boolean;
  eveningReminderTime: TimeOfDay;
  lastReminderDate: IsoDate | null;
  lastMaintenanceDate: IsoDate | null;
  lastExportAt: IsoDateTime | null;
  backupBannerDismissedAt: IsoDateTime | null;
  updatedAt: IsoDateTime;
};

export type Calendar = BaseEntity & {
  name: string;
  kind: 'personal';
};

export const CATEGORY_COLORS = [
  'clay',
  'amber',
  'olive',
  'green',
  'teal',
  'blue',
  'violet',
  'rose',
] as const;
export type CategoryColor = (typeof CATEGORY_COLORS)[number];

export type Category = BaseEntity & {
  name: string;
  normalizedName: string;
  color: CategoryColor;
};

export type TaskStatus = 'active' | 'completed' | 'missed' | 'archived';
export type TaskPriority = 'low' | 'normal' | 'high';
export type TaskScheduleType = 'none' | 'date' | 'datetime';

export type RecurrenceRule = {
  frequency: 'daily' | 'weekly' | 'monthly';
  interval: 1;
  weekdays: number[];
  monthDay: number | null;
};

export type TaskSeries = BaseEntity & {
  calendarId: string;
  title: string;
  note: string;
  priority: TaskPriority;
  categoryId: string | null;
  scheduleType: 'date' | 'datetime';
  plannedTime: TimeOfDay | null;
  rule: RecurrenceRule;
  startDate: IsoDate;
  untilDate: IsoDate | null;
  generatedUntil: IsoDate;
};

export type Task = BaseEntity & {
  calendarId: string;
  title: string;
  note: string;
  status: TaskStatus;
  priority: TaskPriority;
  categoryId: string | null;
  scheduleType: TaskScheduleType;
  plannedDate: IsoDate | null;
  plannedTime: TimeOfDay | null;
  seriesId: string | null;
  occurrenceDate: IsoDate | null;
  isException: boolean;
  sortOrder: string;
  autoMoveCount: number;
  completedAt: IsoDateTime | null;
};

export type TaskMove = BaseEntity & {
  taskId: string;
  fromDate: IsoDate;
  toDate: IsoDate;
  reason: 'auto' | 'manual';
};

export type Habit = BaseEntity & {
  title: string;
  sortOrder: string;
  archivedAt: IsoDate | null;
};

export type HabitScheduleType = 'daily' | 'weekdays' | 'weekly_target';

export type HabitSchedule = BaseEntity & {
  habitId: string;
  effectiveFrom: IsoDate;
  active: boolean;
  type: HabitScheduleType;
  weekdays: number[];
  weeklyTarget: number | null;
};

export type HabitCheck = BaseEntity & {
  habitId: string;
  date: IsoDate;
};

/** Все пользовательские данные — то, что попадает в резервную копию. */
export type DataSet = {
  profile: Profile;
  settings: UserSettings;
  calendars: Calendar[];
  categories: Category[];
  tasks: Task[];
  taskSeries: TaskSeries[];
  taskMoves: TaskMove[];
  habits: Habit[];
  habitSchedules: HabitSchedule[];
  habitChecks: HabitCheck[];
};

export type EntityCollection = Exclude<keyof DataSet, 'profile' | 'settings'>;

export const ENTITY_COLLECTIONS: readonly EntityCollection[] = [
  'calendars',
  'categories',
  'tasks',
  'taskSeries',
  'taskMoves',
  'habits',
  'habitSchedules',
  'habitChecks',
] as const;
