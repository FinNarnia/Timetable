import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import { sortCategories, validateCategoryName } from '../domain/categories';
import { addDaysIso, localDateOf } from '../domain/dates';
import {
  canUncomplete,
  compareInDay,
  compareSortOrder,
  completionPatch,
  duplicateDraft,
  emptyDraft,
  groupKey,
  moveNeighbor,
  needsRenumber,
  validateTaskDraft,
  type MoveDirection,
  type TaskDraft,
  type TaskDraftErrors,
} from '../domain/tasks';
import type { Category, CategoryColor, Task, TaskMove } from '../domain/types';
import type { AppDeps } from './services';

export class TaskValidationError extends Error {
  constructor(readonly errors: TaskDraftErrors) {
    super('Проверьте поля задачи');
    this.name = 'TaskValidationError';
  }
}

export class CategoryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CategoryValidationError';
  }
}

export type QuickAddTarget = 'today' | 'tomorrow' | 'none';

/** Запись изменили в другой вкладке после открытия формы (п. 10.3). */
export class ConflictError extends Error {
  constructor() {
    super('Задачу изменили в другой вкладке');
    this.name = 'ConflictError';
  }
}

/** Проверка rev перед сохранением формы; undefined — сохранить без проверки («Сохранить мои изменения»). */
export function assertRev(current: { rev: number }, expectedRev: number | undefined): void {
  if (expectedRev !== undefined && current.rev !== expectedRev) throw new ConflictError();
}

/** Новая позиция задачи после «Выше» / «Ниже» — для объявления «Позиция 2 из 5» (п. 6.13). */
export type MoveResult = { position: number; total: number };

/** Что удалено одной операцией — чтобы «Отменить» вернуло ровно это (п. 6.12). */
export type DeletionToken = { taskIds: string[]; seriesIds: string[] };

/** Задачи: создание, редактирование, выполнение, дублирование, удаление (п. 6.7–6.12). */
export class TaskService {
  constructor(private readonly d: AppDeps) {}

  /** Все неудалённые задачи профиля. Для MVP (до 10 000 задач) читаем целиком. */
  list(): Promise<Task[]> {
    return this.d.repos.tasks.list();
  }

  async create(draft: TaskDraft): Promise<Task> {
    const today = this.d.clock.today();
    const result = validateTaskDraft(draft, today);
    if (!result.ok) throw new TaskValidationError(result.errors);
    if (result.value.repeat) throw new Error('Повторяющаяся задача создаётся через SeriesService');
    return this.d.uow.run(async () => {
      const { repeat, ...value } = result.value;
      if (value.categoryId) await this.requireCategory(value.categoryId);
      const [calendar] = await this.d.repos.calendars.list();
      if (!calendar) throw new Error('Не найден личный календарь');
      const sortOrder = await this.endOfGroup(value.plannedDate);
      const created = await this.d.repos.tasks.create({
        ...value,
        calendarId: calendar.id,
        status: 'active',
        seriesId: null,
        occurrenceDate: null,
        isException: false,
        sortOrder,
        autoMoveCount: 0,
        completedAt: null,
      });
      return this.compactGroup(created);
    });
  }

  /** История переносов — для меток «Перенесено с ДД.ММ» (п. 6.10). */
  listMoves(): Promise<TaskMove[]> {
    return this.d.repos.taskMoves.list();
  }

  /** Быстрое добавление: только название и срок «Сегодня / Завтра / Без даты» (п. 6.7). */
  quickAdd(title: string, target: QuickAddTarget): Promise<Task> {
    const today = this.d.clock.today();
    const plannedDate = target === 'today' ? today : target === 'tomorrow' ? addDaysIso(today, 1) : null;
    return this.create(emptyDraft({ title, scheduleType: plannedDate ? 'date' : 'none', plannedDate }));
  }

  /**
   * Редактирование (п. 6.8). Ручная смена даты активной одиночной задачи пишется в историю переносов
   * (TaskMove, reason = "manual"), задача встаёт в конец группы нового дня.
   */
  async update(id: string, draft: TaskDraft, expectedRev?: number): Promise<Task> {
    const current = await this.require(id);
    if (current.status === 'missed') throw new Error('Пропущенную задачу можно только просматривать');
    if (current.seriesId) throw new Error('Экземпляр серии меняется через SeriesService');
    const result = validateTaskDraft(draft, this.d.clock.today(), current.plannedDate);
    if (!result.ok) throw new TaskValidationError(result.errors);
    const { repeat, ...value } = result.value;
    return this.d.uow.run(async () => {
      assertRev(await this.require(id), expectedRev);
      if (value.categoryId && value.categoryId !== current.categoryId) await this.requireCategory(value.categoryId);
      const patch: Partial<Task> = { ...value };
      const dateChanged = value.plannedDate !== current.plannedDate;
      if (dateChanged && current.status === 'active') {
        patch.sortOrder = await this.endOfGroup(value.plannedDate, id);
        if (current.seriesId === null && current.plannedDate && value.plannedDate) {
          await this.d.repos.taskMoves.create({
            taskId: id,
            fromDate: current.plannedDate,
            toDate: value.plannedDate,
            reason: 'manual',
          });
        }
      }
      const updated = await this.d.repos.tasks.update(id, patch);
      return dateChanged ? this.compactGroup(updated) : updated;
    });
  }

  /** Выполнить задачу (п. 6.9). */
  async complete(id: string): Promise<Task> {
    const task = await this.require(id);
    if (task.status !== 'active') return task;
    return this.d.repos.tasks.update(id, completionPatch(task, this.d.clock.today(), this.d.clock.nowIso()));
  }

  /** Снять отметку — только в день выполнения (п. 6.9). */
  async uncomplete(id: string): Promise<Task> {
    const task = await this.require(id);
    if (!canUncomplete(task, this.d.clock.today(), localDateOf)) {
      throw new Error('Отметку можно снять только в день выполнения');
    }
    return this.d.repos.tasks.update(id, { status: 'active', completedAt: null });
  }

  /** Независимая одиночная копия сразу после оригинала (п. 6.11). */
  async duplicate(id: string): Promise<Task> {
    const original = await this.require(id);
    const draft = duplicateDraft(original, this.d.clock.today());
    return this.d.uow.run(async () => {
      const sameGroup = groupKey(draft) === groupKey(original) && original.status === 'active';
      let sortOrder: string;
      if (sameGroup) {
        const group = (await this.activeGroup(draft.plannedDate)).sort(compareSortOrder);
        const index = group.findIndex((t) => t.id === original.id);
        const next = group[index + 1];
        sortOrder = generateKeyBetween(original.sortOrder, next && next.sortOrder > original.sortOrder ? next.sortOrder : null);
      } else {
        sortOrder = await this.endOfGroup(draft.plannedDate);
      }
      const copy = await this.d.repos.tasks.create({
        ...draft,
        calendarId: original.calendarId,
        status: 'active',
        seriesId: null,
        occurrenceDate: null,
        isException: false,
        sortOrder,
        autoMoveCount: 0,
        completedAt: null,
      });
      return this.compactGroup(copy);
    });
  }

  /**
   * «Выше» / «Ниже» (п. 6.13): меняет местами sortOrder задачи и её соседа в порядке показа.
   * При совпадающих или слишком длинных ключах группа сначала перенумеровывается — всё одной транзакцией.
   * Возвращает новую позицию или null, если двигать некуда.
   */
  move(id: string, direction: MoveDirection): Promise<MoveResult | null> {
    return this.d.uow.run(async () => {
      const task = await this.require(id);
      if (task.status !== 'active') return null;
      let group = await this.activeGroup(task.plannedDate);
      if (needsRenumber(group)) group = await this.renumber(group);
      const self = group.find((t) => t.id === id)!;
      const neighbor = moveNeighbor(group, id, direction);
      if (!neighbor) return null;
      await this.d.repos.tasks.update(self.id, { sortOrder: neighbor.sortOrder });
      await this.d.repos.tasks.update(neighbor.id, { sortOrder: self.sortOrder });
      const after = await this.activeGroup(task.plannedDate);
      return { position: after.findIndex((t) => t.id === id) + 1, total: after.length };
    });
  }

  /** Мягкое удаление (п. 6.12): сразу deletedAt, отмена в течение 5 секунд — через undoDelete. */
  async delete(id: string): Promise<DeletionToken> {
    await this.d.repos.tasks.softDelete(id);
    return { taskIds: [id], seriesIds: [] };
  }

  /** Отмена снимает deletedAt со всех записей, удалённых этой операцией (п. 6.12). */
  async undoDelete(token: DeletionToken): Promise<void> {
    await this.d.uow.run(async () => {
      for (const id of token.seriesIds) await this.d.repos.taskSeries.restore(id);
      for (const id of token.taskIds) await this.d.repos.tasks.restore(id);
    });
  }

  async require(id: string): Promise<Task> {
    const task = await this.d.repos.tasks.getById(id);
    if (!task) throw new Error('Задача не найдена');
    return task;
  }

  private async requireCategory(id: string): Promise<void> {
    if (!(await this.d.repos.categories.getById(id))) throw new Error('Категория не найдена');
  }

  async activeGroup(plannedDate: string | null, excludeId?: string): Promise<Task[]> {
    const key = plannedDate ?? 'none';
    const all = await this.d.repos.tasks.list();
    return all.filter((t) => t.status === 'active' && groupKey(t) === key && t.id !== excludeId).sort(compareInDay);
  }

  /** Новые ключи всей группе в текущем порядке показа (п. 6.13). Вызывается внутри транзакции. */
  private async renumber(group: Task[]): Promise<Task[]> {
    const keys = generateNKeysBetween(null, null, group.length);
    const result: Task[] = [];
    for (const [i, t] of group.entries()) result.push(await this.d.repos.tasks.update(t.id, { sortOrder: keys[i]! }));
    return result;
  }

  /** После вставки: если ключи в группе выросли длиннее 32 символов или совпали — перенумеровать. */
  async compactGroup(task: Task): Promise<Task> {
    if (task.status !== 'active') return task;
    const group = await this.activeGroup(task.plannedDate);
    if (!needsRenumber(group)) return task;
    const renumbered = await this.renumber(group);
    return renumbered.find((t) => t.id === task.id) ?? task;
  }

  /** Ключ сортировки для конца группы дня (п. 6.7, 6.13). */
  async endOfGroup(plannedDate: string | null, excludeId?: string): Promise<string> {
    const group = (await this.activeGroup(plannedDate, excludeId)).sort(compareSortOrder);
    const last = group[group.length - 1];
    return generateKeyBetween(last ? last.sortOrder : null, null);
  }
}

export type CategoryWithCount = Category & { taskCount: number };

/** Категории (п. 6.4, блок «Категории» в п. 10.4). */
export class CategoryService {
  constructor(private readonly d: AppDeps) {}

  async list(): Promise<Category[]> {
    return sortCategories(await this.d.repos.categories.list());
  }

  /** Категории с числом неудалённых задач — для настроек и подтверждения удаления. */
  async listWithCounts(): Promise<CategoryWithCount[]> {
    const [categories, tasks] = await Promise.all([this.list(), this.d.repos.tasks.list()]);
    return categories.map((c) => ({ ...c, taskCount: tasks.filter((t) => t.categoryId === c.id).length }));
  }

  create(name: string, color: CategoryColor): Promise<Category> {
    return this.d.uow.run(async () => {
      const checked = validateCategoryName(name, await this.d.repos.categories.list());
      if (!checked.ok) throw new CategoryValidationError(checked.error);
      return this.d.repos.categories.create({ name: checked.name, normalizedName: checked.normalizedName, color });
    });
  }

  rename(id: string, name: string): Promise<Category> {
    return this.d.uow.run(async () => {
      const checked = validateCategoryName(name, await this.d.repos.categories.list(), id);
      if (!checked.ok) throw new CategoryValidationError(checked.error);
      return this.d.repos.categories.update(id, { name: checked.name, normalizedName: checked.normalizedName });
    });
  }

  recolor(id: string, color: CategoryColor): Promise<Category> {
    return this.d.repos.categories.update(id, { color });
  }

  /** Удаление: задачи и серии не удаляются, их категория становится пустой — одной транзакцией. */
  delete(id: string): Promise<void> {
    return this.d.uow.run(async () => {
      await this.d.repos.categories.softDelete(id);
      for (const task of await this.d.repos.tasks.list({ includeDeleted: true })) {
        if (task.categoryId === id) await this.d.repos.tasks.update(task.id, { categoryId: null }, { includeDeleted: true });
      }
      for (const series of await this.d.repos.taskSeries.list({ includeDeleted: true })) {
        if (series.categoryId === id) await this.d.repos.taskSeries.update(series.id, { categoryId: null }, { includeDeleted: true });
      }
    });
  }
}
