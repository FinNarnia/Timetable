#!/usr/bin/env node
// Генератор резервной копии с тестовыми данными (п. 17 ТЗ).
// Использование: pnpm seed -- --tasks 10000 --checks 20000 --habits 20 --out fixtures/backups/benchmark.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { v7 as uuidv7 } from 'uuid';
import { generateNKeysBetween } from 'fractional-indexing';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a !== '--')
    .reduce((acc, cur, i, arr) => (cur.startsWith('--') ? [...acc, [cur.slice(2), arr[i + 1]]] : acc), []),
);

const TASKS = Number(args.tasks ?? 10000);
const CHECKS = Number(args.checks ?? 20000);
const HABITS = Number(args.habits ?? 20);
const NAME = args.name ?? 'Тестовый профиль';
const OUT = args.out ?? 'fixtures/backups/benchmark.json';

const userId = uuidv7();
const now = new Date('2026-10-09T12:00:00.000Z').toISOString();
const base = (id) => ({ id, userId, rev: 1, createdAt: now, updatedAt: now, deletedAt: null });
const day = (offset) => {
  const d = new Date(Date.UTC(2026, 9, 9) + offset * 86400000);
  return d.toISOString().slice(0, 10);
};

const calendarId = uuidv7();
const categories = ['Работа', 'Дом', 'Здоровье'].map((name, i) => ({
  ...base(uuidv7()),
  name,
  normalizedName: name.toLocaleLowerCase('ru-RU'),
  color: ['blue', 'green', 'clay'][i],
}));

const taskKeys = generateNKeysBetween(null, null, TASKS);
const habitKeys = generateNKeysBetween(null, null, HABITS);
const tasks = Array.from({ length: TASKS }, (_, i) => {
  const offset = (i % 400) - 300;
  const completed = offset < 0 && i % 3 !== 0;
  const noDate = i % 17 === 0;
  return {
    ...base(uuidv7()),
    calendarId,
    title: `Задача номер ${i + 1}`,
    note: i % 5 === 0 ? 'Заметка к задаче' : '',
    status: completed ? 'completed' : 'active',
    priority: ['low', 'normal', 'high'][i % 3],
    categoryId: categories[i % 3].id,
    scheduleType: noDate ? 'none' : i % 4 === 0 ? 'datetime' : 'date',
    plannedDate: noDate ? null : day(offset),
    plannedTime: !noDate && i % 4 === 0 ? '09:30' : null,
    seriesId: null,
    occurrenceDate: null,
    isException: false,
    sortOrder: taskKeys[i],
    autoMoveCount: 0,
    completedAt: completed ? now : null,
  };
});

const habits = Array.from({ length: HABITS }, (_, i) => ({
  ...base(uuidv7()),
  title: `Привычка ${i + 1}`,
  sortOrder: habitKeys[i],
  archivedAt: null,
}));
const habitSchedules = habits.map((h) => ({
  ...base(uuidv7()),
  habitId: h.id,
  effectiveFrom: day(-1000),
  active: true,
  type: 'daily',
  weekdays: [],
  weeklyTarget: null,
}));
const habitChecks = Array.from({ length: Math.min(CHECKS, HABITS * 1000) }, (_, i) => ({
  ...base(uuidv7()),
  habitId: habits[i % HABITS].id,
  date: day(-Math.floor(i / HABITS)),
}));

const backup = {
  format: 'moy-ritm-backup',
  schemaVersion: 1,
  appVersion: 'seed',
  exportedAt: now,
  data: {
    profile: { id: userId, name: NAME, createdAt: now, updatedAt: now },
    settings: {
      userId,
      locale: 'ru-RU',
      weekStartsOn: 1,
      eveningReminderEnabled: true,
      eveningReminderTime: '20:00',
      lastReminderDate: null,
      lastMaintenanceDate: null,
      lastExportAt: null,
      backupBannerDismissedAt: null,
      updatedAt: now,
    },
    calendars: [{ ...base(calendarId), name: 'Личный', kind: 'personal' }],
    categories,
    tasks,
    taskSeries: [],
    taskMoves: [],
    habits,
    habitSchedules,
    habitChecks,
  },
};

mkdirSync(dirname(OUT), { recursive: true });
const json = JSON.stringify(backup);
writeFileSync(OUT, json);
console.log(`Записано ${OUT}: ${(json.length / 1024 / 1024).toFixed(2)} МБ, задач ${TASKS}, отметок ${habitChecks.length}`);
