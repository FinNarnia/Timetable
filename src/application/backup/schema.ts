import { z } from 'zod';
import { CATEGORY_COLORS, type DataSet } from '../../domain/types';

// Схема файла резервной копии (п. 4.3–4.4). Файл считается недоверенным: строгая проверка,
// лишние поля отбрасываются (поведение z.object по умолчанию), п. 15.1.

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoDateTime = z.string().datetime({ offset: true });
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const id = z.string().min(1).max(100);
const weekday = z.number().int().min(1).max(7);

const base = {
  id,
  userId: id,
  rev: z.number().int().min(1),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  deletedAt: isoDateTime.nullable(),
};

const priority = z.enum(['low', 'normal', 'high']);

export const profileSchema = z.object({
  id,
  name: z.string().min(1).max(200),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

export const settingsSchema = z.object({
  userId: id,
  locale: z.literal('ru-RU'),
  weekStartsOn: z.literal(1),
  eveningReminderEnabled: z.boolean(),
  eveningReminderTime: timeOfDay,
  lastReminderDate: isoDate.nullable(),
  lastMaintenanceDate: isoDate.nullable(),
  lastExportAt: isoDateTime.nullable(),
  backupBannerDismissedAt: isoDateTime.nullable(),
  updatedAt: isoDateTime,
});

const calendarSchema = z.object({ ...base, name: z.string().max(200), kind: z.literal('personal') });

const categorySchema = z.object({
  ...base,
  name: z.string().min(1).max(30),
  normalizedName: z.string().max(60),
  color: z.enum(CATEGORY_COLORS),
});

const recurrenceRuleSchema = z.object({
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  interval: z.literal(1),
  weekdays: z.array(weekday).max(7),
  monthDay: z.number().int().min(1).max(31).nullable(),
});

const taskSeriesSchema = z.object({
  ...base,
  calendarId: id,
  title: z.string().max(120),
  note: z.string().max(2000),
  priority,
  categoryId: id.nullable(),
  scheduleType: z.enum(['date', 'datetime']),
  plannedTime: timeOfDay.nullable(),
  rule: recurrenceRuleSchema,
  startDate: isoDate,
  untilDate: isoDate.nullable(),
  generatedUntil: isoDate,
});

const taskSchema = z.object({
  ...base,
  calendarId: id,
  title: z.string().max(120),
  note: z.string().max(2000),
  status: z.enum(['active', 'completed', 'missed', 'archived']),
  priority,
  categoryId: id.nullable(),
  scheduleType: z.enum(['none', 'date', 'datetime']),
  plannedDate: isoDate.nullable(),
  plannedTime: timeOfDay.nullable(),
  seriesId: id.nullable(),
  occurrenceDate: isoDate.nullable(),
  isException: z.boolean(),
  sortOrder: z.string().max(200),
  autoMoveCount: z.number().int().min(0),
  completedAt: isoDateTime.nullable(),
});

const taskMoveSchema = z.object({
  ...base,
  taskId: id,
  fromDate: isoDate,
  toDate: isoDate,
  reason: z.enum(['auto', 'manual']),
});

const habitSchema = z.object({
  ...base,
  title: z.string().max(60),
  sortOrder: z.string().max(200),
  archivedAt: isoDate.nullable(),
});

const habitScheduleSchema = z.object({
  ...base,
  habitId: id,
  effectiveFrom: isoDate,
  active: z.boolean(),
  type: z.enum(['daily', 'weekdays', 'weekly_target']),
  weekdays: z.array(weekday).max(7),
  weeklyTarget: z.number().int().min(1).max(6).nullable(),
});

const habitCheckSchema = z.object({ ...base, habitId: id, date: isoDate });

export const dataSetSchema = z.object({
  profile: profileSchema,
  settings: settingsSchema,
  calendars: z.array(calendarSchema),
  categories: z.array(categorySchema),
  tasks: z.array(taskSchema),
  taskSeries: z.array(taskSeriesSchema),
  taskMoves: z.array(taskMoveSchema),
  habits: z.array(habitSchema),
  habitSchedules: z.array(habitScheduleSchema),
  habitChecks: z.array(habitCheckSchema),
});

export const BACKUP_FORMAT = 'moy-ritm-backup';

export const backupEnvelopeSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  schemaVersion: z.number().int().min(1),
  appVersion: z.string().max(50),
  exportedAt: isoDateTime,
  data: z.unknown(),
});

export type BackupFile = {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  data: DataSet;
};
