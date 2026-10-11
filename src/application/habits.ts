import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import {
  CHECK_BLOCK_TEXT,
  checkBlock,
  compareHabits,
  lastActiveVersion,
  latestVersion,
  mondayOf,
  sortedVersions,
  validateHabitDraft,
  type HabitDraft,
  type HabitDraftErrors,
  type HabitScheduleFields,
} from '../domain/habits';
import { needsRenumber, type MoveDirection } from '../domain/tasks';
import type { Habit, HabitCheck, HabitSchedule, IsoDate } from '../domain/types';
import type { AppDeps } from './services';
import type { MoveResult } from './tasks';

export class HabitValidationError extends Error {
  constructor(readonly errors: HabitDraftErrors) {
    super('Проверьте поля привычки');
    this.name = 'HabitValidationError';
  }
}

/** Отметку за этот день поставить нельзя — текст причины для подсказки (п. 8.4, 11.14). */
export class HabitCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HabitCheckError';
  }
}

/** Привычка с версиями расписания по возрастанию даты. */
export type HabitView = { habit: Habit; versions: HabitSchedule[] };

/** Что вернуть при «Отменить» после архивирования (п. 8.6). */
export type ArchiveToken = { habitId: string; createdVersionId: string | null; previous: HabitSchedule | null };

const SCHEDULE_KEYS = ['type', 'weekdays', 'weeklyTarget'] as const;
const sameSchedule = (a: HabitScheduleFields, b: HabitScheduleFields) =>
  SCHEDULE_KEYS.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));

/**
 * Привычки (раздел 8): создание, изменение с версиями расписания, архив и возврат, отметки, ручной порядок.
 * HabitSchedule.active — единственный источник истины об архиве; Habit.archivedAt пересчитывается в той же транзакции.
 */
export class HabitService {
  constructor(private readonly d: AppDeps) {}

  /** Все привычки (активные и архивные) с версиями расписания. */
  async list(): Promise<HabitView[]> {
    const [habits, schedules] = await Promise.all([this.d.repos.habits.list(), this.d.repos.habitSchedules.list()]);
    const byHabit = new Map<string, HabitSchedule[]>();
    for (const s of schedules) {
      const list = byHabit.get(s.habitId) ?? [];
      list.push(s);
      byHabit.set(s.habitId, list);
    }
    return habits.sort(compareHabits).map((habit) => ({ habit, versions: sortedVersions(byHabit.get(habit.id) ?? []) }));
  }

  /** Отметки за период (для недели на экране и блока «Сегодня»). */
  checksBetween(from: IsoDate, to: IsoDate): Promise<HabitCheck[]> {
    return this.d.repos.habitChecks.listBetween(from, to);
  }

  /** Новая привычка (п. 8.2): первая версия расписания с effectiveFrom = сегодня, в конец списка. */
  async create(draft: HabitDraft): Promise<Habit> {
    const checked = validateHabitDraft(draft);
    if (!checked.ok) throw new HabitValidationError(checked.errors);
    const today = this.d.clock.today();
    return this.d.uow.run(async () => {
      const active = (await this.d.repos.habits.list()).filter((h) => h.archivedAt === null).sort(compareHabits);
      const last = active[active.length - 1];
      const habit = await this.d.repos.habits.create({
        title: checked.title,
        sortOrder: generateKeyBetween(last ? last.sortOrder : null, null),
        archivedAt: null,
      });
      await this.d.repos.habitSchedules.create({ habitId: habit.id, effectiveFrom: today, active: true, ...checked.schedule });
      return habit;
    });
  }

  /**
   * Изменение (п. 8.5): название — сразу и для прошлых отчётов. Новое расписание действует с понедельника текущей недели;
   * если последняя версия начинается на этой неделе (привычка создана на этой неделе или уже менялась) — она перезаписывается.
   */
  async update(id: string, draft: HabitDraft): Promise<Habit> {
    const checked = validateHabitDraft(draft);
    if (!checked.ok) throw new HabitValidationError(checked.errors);
    const today = this.d.clock.today();
    return this.d.uow.run(async () => {
      const { habit, versions } = await this.require(id);
      if (habit.archivedAt !== null) throw new Error('Архивную привычку сначала нужно вернуть');
      const latest = latestVersion(versions)!;
      if (!sameSchedule(latest, checked.schedule)) {
        const monday = mondayOf(today);
        if (latest.effectiveFrom >= monday) await this.d.repos.habitSchedules.update(latest.id, { ...checked.schedule });
        else await this.d.repos.habitSchedules.create({ habitId: id, effectiveFrom: monday, active: true, ...checked.schedule });
      }
      return habit.title === checked.title ? habit : this.d.repos.habits.update(id, { title: checked.title });
    });
  }

  /** «Убрать в архив» (п. 8.6): версия active = false с сегодняшнего дня; день архивирования в план не входит. */
  async archive(id: string): Promise<ArchiveToken> {
    const today = this.d.clock.today();
    return this.d.uow.run(async () => {
      const { habit, versions } = await this.require(id);
      if (habit.archivedAt !== null) throw new Error('Привычка уже в архиве');
      const latest = latestVersion(versions)!;
      let token: ArchiveToken;
      if (latest.effectiveFrom === today) {
        // Создана или изменена сегодня: уникальность habitId + effectiveFrom — меняем эту версию.
        token = { habitId: id, createdVersionId: null, previous: { ...latest } };
        await this.d.repos.habitSchedules.update(latest.id, { active: false });
      } else {
        const created = await this.d.repos.habitSchedules.create({
          habitId: id,
          effectiveFrom: today,
          active: false,
          type: latest.type,
          weekdays: latest.weekdays,
          weeklyTarget: latest.weeklyTarget,
        });
        token = { habitId: id, createdVersionId: created.id, previous: null };
      }
      await this.d.repos.habits.update(id, { archivedAt: today });
      return token;
    });
  }

  /** Отмена архивирования в течение 5 секунд — как будто его не было. */
  async undoArchive(token: ArchiveToken): Promise<void> {
    await this.d.uow.run(async () => {
      if (token.createdVersionId) await this.d.repos.habitSchedules.remove(token.createdVersionId);
      if (token.previous) await this.d.repos.habitSchedules.update(token.previous.id, { active: token.previous.active });
      await this.syncArchivedAt(token.habitId);
    });
  }

  /** «Вернуть» (п. 8.6): снова в плане с дня возврата, расписание — последнее активное; промежуток в архиве в план не входит. */
  async unarchive(id: string): Promise<void> {
    const today = this.d.clock.today();
    await this.d.uow.run(async () => {
      const { habit, versions } = await this.require(id);
      if (habit.archivedAt === null) return;
      const latest = latestVersion(versions)!;
      if (latest.effectiveFrom === today) {
        await this.d.repos.habitSchedules.update(latest.id, { active: true });
      } else {
        const params = lastActiveVersion(versions) ?? latest;
        await this.d.repos.habitSchedules.create({
          habitId: id,
          effectiveFrom: today,
          active: true,
          type: params.type,
          weekdays: params.weekdays,
          weeklyTarget: params.weeklyTarget,
        });
      }
      await this.syncArchivedAt(id);
    });
  }

  /**
   * Отметка (п. 8.4): ставит или снимает. Повторная отметка восстанавливает прежнюю запись (уникальность habitId + date).
   * Возвращает новое состояние: true — выполнено.
   */
  async toggleCheck(habitId: string, date: IsoDate): Promise<boolean> {
    const today = this.d.clock.today();
    return this.d.uow.run(async () => {
      const { versions } = await this.require(habitId);
      const block = checkBlock(versions, date, today);
      if (block) throw new HabitCheckError(CHECK_BLOCK_TEXT[block]);
      const existing = await this.d.repos.habitChecks.findByDay(habitId, date);
      if (!existing) {
        await this.d.repos.habitChecks.create({ habitId, date });
        return true;
      }
      if (existing.deletedAt !== null) {
        await this.d.repos.habitChecks.restore(existing.id);
        return true;
      }
      await this.d.repos.habitChecks.softDelete(existing.id);
      return false;
    });
  }

  /** «Выше» / «Ниже» среди активных привычек (п. 8.7): обмен ключами, при необходимости — перенумерация. */
  move(id: string, direction: MoveDirection): Promise<MoveResult | null> {
    return this.d.uow.run(async () => {
      let active = (await this.d.repos.habits.list()).filter((h) => h.archivedAt === null).sort(compareHabits);
      if (needsRenumber(active)) {
        const keys = generateNKeysBetween(null, null, active.length);
        active = await Promise.all(active.map((h, i) => this.d.repos.habits.update(h.id, { sortOrder: keys[i]! })));
      }
      const index = active.findIndex((h) => h.id === id);
      const neighbor = active[direction === 'up' ? index - 1 : index + 1];
      const self = active[index];
      if (!self || !neighbor) return null;
      await this.d.repos.habits.update(self.id, { sortOrder: neighbor.sortOrder });
      await this.d.repos.habits.update(neighbor.id, { sortOrder: self.sortOrder });
      return { position: direction === 'up' ? index : index + 2, total: active.length };
    });
  }

  private async require(id: string): Promise<HabitView> {
    const habit = await this.d.repos.habits.getById(id);
    if (!habit) throw new Error('Привычка не найдена');
    const versions = sortedVersions((await this.d.repos.habitSchedules.list()).filter((s) => s.habitId === id));
    if (versions.length === 0) throw new Error('У привычки нет расписания');
    return { habit, versions };
  }

  /** Пересчёт производного archivedAt по последней версии (инвариант п. 13.8). */
  private async syncArchivedAt(id: string): Promise<void> {
    const { habit, versions } = await this.require(id);
    const last = latestVersion(versions)!;
    const archivedAt = last.active ? null : last.effectiveFrom;
    if (habit.archivedAt !== archivedAt) await this.d.repos.habits.update(id, { archivedAt });
  }
}
