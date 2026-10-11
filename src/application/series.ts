import { generateKeyBetween } from 'fractional-indexing';
import { horizonEnd, instanceFields, occurrenceKey, occurrences, occursOn, ruleFromRepeat } from '../domain/recurrence';
import { compareSortOrder, validateTaskDraft, type TaskDraft } from '../domain/tasks';
import type { IsoDate, Task, TaskSeries } from '../domain/types';
import type { AppDeps } from './services';
import { assertRev, TaskService, TaskValidationError, type DeletionToken } from './tasks';

/** Результат создания серии: первый экземпляр в пределах горизонта (может не быть, если серия начинается позже). */
export type SeriesCreated = { series: TaskSeries; first: Task | null };

/**
 * Повторяющиеся задачи (п. 6.6, 6.8): серия — шаблон, экземпляры создаются вперёд на 14 дней.
 * «Только эту задачу» делает экземпляр исключением; «Всю серию» меняет шаблон и пересоздаёт будущие экземпляры.
 */
export class SeriesService {
  private readonly tasks: TaskService;

  constructor(private readonly d: AppDeps) {
    this.tasks = new TaskService(d);
  }

  list(options: { includeDeleted?: boolean } = {}): Promise<TaskSeries[]> {
    return this.d.repos.taskSeries.list(options);
  }

  get(id: string): Promise<TaskSeries | undefined> {
    return this.d.repos.taskSeries.getById(id);
  }

  /** Новая повторяющаяся задача: серия + экземпляры от первой даты до горизонта. */
  async create(draft: TaskDraft): Promise<SeriesCreated> {
    const today = this.d.clock.today();
    const result = validateTaskDraft(draft, today);
    if (!result.ok) throw new TaskValidationError(result.errors);
    const value = result.value;
    if (!value.repeat || !value.plannedDate || value.scheduleType === 'none') throw new Error('Нет правила повторения');
    return this.d.uow.run(async () => {
      if (value.categoryId) await this.requireCategory(value.categoryId);
      const [calendar] = await this.d.repos.calendars.list();
      if (!calendar) throw new Error('Не найден личный календарь');
      const startDate = value.plannedDate!;
      const series = await this.d.repos.taskSeries.create({
        calendarId: calendar.id,
        title: value.title,
        note: value.note,
        priority: value.priority,
        categoryId: value.categoryId,
        scheduleType: value.scheduleType as 'date' | 'datetime',
        plannedTime: value.plannedTime,
        rule: ruleFromRepeat(value.repeat!, startDate),
        startDate,
        untilDate: value.repeat!.untilDate,
        generatedUntil: horizonEnd(today),
      });
      const created = await this.generate(series, today, new Set());
      return { series, first: created[0] ?? null };
    });
  }

  /**
   * Включение повторения у одиночной задачи с датой (п. 6.8): создаётся серия,
   * исходная задача становится её первым экземпляром.
   */
  async enableRepeat(taskId: string, draft: TaskDraft, expectedRev?: number): Promise<SeriesCreated> {
    const today = this.d.clock.today();
    const current = await this.tasks.require(taskId);
    if (current.seriesId) throw new Error('Задача уже повторяется');
    const result = validateTaskDraft(draft, today, current.plannedDate);
    if (!result.ok) throw new TaskValidationError(result.errors);
    const value = result.value;
    if (!value.repeat || !value.plannedDate || value.scheduleType === 'none') throw new Error('Нет правила повторения');
    return this.d.uow.run(async () => {
      const task = await this.tasks.require(taskId);
      assertRev(task, expectedRev);
      if (value.categoryId && value.categoryId !== task.categoryId) await this.requireCategory(value.categoryId);
      const startDate = value.plannedDate!;
      const series = await this.d.repos.taskSeries.create({
        calendarId: task.calendarId,
        title: value.title,
        note: value.note,
        priority: value.priority,
        categoryId: value.categoryId,
        scheduleType: value.scheduleType as 'date' | 'datetime',
        plannedTime: value.plannedTime,
        rule: ruleFromRepeat(value.repeat!, startDate),
        startDate,
        untilDate: value.repeat!.untilDate,
        generatedUntil: horizonEnd(today),
      });
      const dateChanged = task.plannedDate !== startDate;
      if (dateChanged && task.status === 'active' && task.plannedDate) {
        await this.d.repos.taskMoves.create({ taskId: task.id, fromDate: task.plannedDate, toDate: startDate, reason: 'manual' });
      }
      const first = await this.d.repos.tasks.update(task.id, {
        title: value.title,
        note: value.note,
        priority: value.priority,
        categoryId: value.categoryId,
        scheduleType: value.scheduleType,
        plannedDate: startDate,
        plannedTime: value.plannedTime,
        seriesId: series.id,
        occurrenceDate: startDate,
        isException: false,
        ...(dateChanged && task.status === 'active' ? { sortOrder: await this.tasks.endOfGroup(startDate, task.id) } : {}),
      });
      await this.generate(series, today, new Set([occurrenceKey(series.id, startDate)]));
      return { series, first };
    });
  }

  /**
   * «Только эту задачу» (п. 6.6): экземпляр становится независимым исключением.
   * Правило повторения в этом режиме не меняется.
   */
  async updateInstance(taskId: string, draft: TaskDraft, expectedRev?: number): Promise<Task> {
    const today = this.d.clock.today();
    const current = await this.tasks.require(taskId);
    if (!current.seriesId) throw new Error('Это не экземпляр серии');
    if (current.status === 'missed') throw new Error('Пропущенную задачу можно только просматривать');
    const result = validateTaskDraft({ ...draft, repeat: null }, today, current.plannedDate);
    if (!result.ok) throw new TaskValidationError(result.errors);
    const { repeat, ...value } = result.value;
    if (value.scheduleType === 'none' || !value.plannedDate) throw new TaskValidationError({ plannedDate: 'Выберите дату' });
    return this.d.uow.run(async () => {
      const task = await this.tasks.require(taskId);
      assertRev(task, expectedRev);
      if (value.categoryId && value.categoryId !== task.categoryId) await this.requireCategory(value.categoryId);
      const dateChanged = value.plannedDate !== task.plannedDate;
      const updated = await this.d.repos.tasks.update(taskId, {
        ...value,
        isException: true,
        ...(dateChanged && task.status === 'active' ? { sortOrder: await this.tasks.endOfGroup(value.plannedDate, taskId) } : {}),
      });
      return dateChanged ? this.tasks.compactGroup(updated) : updated;
    });
  }

  /**
   * «Всю серию» (п. 6.6): меняется шаблон. Активные не-исключения с датой от сегодня пересоздаются по новому шаблону;
   * исключения, выполненные и пропущенные экземпляры, выполненный сегодняшний не меняются.
   * Дата экземпляра в этом режиме не меняется — первая дата серии остаётся прежней.
   */
  async updateSeries(taskId: string, draft: TaskDraft, expectedRev?: number): Promise<TaskSeries> {
    const today = this.d.clock.today();
    const instance = await this.tasks.require(taskId);
    if (!instance.seriesId) throw new Error('Это не экземпляр серии');
    const series = await this.requireSeries(instance.seriesId);
    const result = validateTaskDraft({ ...draft, plannedDate: instance.plannedDate }, today, instance.plannedDate, series.startDate);
    if (!result.ok) throw new TaskValidationError(result.errors);
    const value = result.value;
    if (!value.repeat || value.scheduleType === 'none') throw new Error('Нет правила повторения');
    return this.d.uow.run(async () => {
      assertRev(await this.tasks.require(taskId), expectedRev);
      if (value.categoryId && value.categoryId !== series.categoryId) await this.requireCategory(value.categoryId);
      const next = await this.d.repos.taskSeries.update(series.id, {
        title: value.title,
        note: value.note,
        priority: value.priority,
        categoryId: value.categoryId,
        scheduleType: value.scheduleType as 'date' | 'datetime',
        plannedTime: value.plannedTime,
        rule: ruleFromRepeat(value.repeat!, series.startDate),
        untilDate: value.repeat!.untilDate,
        generatedUntil: series.generatedUntil > horizonEnd(today) ? series.generatedUntil : horizonEnd(today),
      });
      const all = (await this.d.repos.tasks.list({ includeDeleted: true })).filter((t) => t.seriesId === series.id);
      const keep = new Set<string>();
      const end = horizonEnd(today);
      for (const t of all) {
        const regenerable =
          t.deletedAt === null && t.status === 'active' && !t.isException && t.plannedDate !== null && t.plannedDate >= today;
        if (!regenerable) {
          keep.add(occurrenceKey(series.id, t.occurrenceDate!));
          continue;
        }
        // Удаляются и создаются заново: если дата осталась в правиле — обновляем по шаблону на месте (id и порядок сохраняются).
        if (occursOn(next, t.occurrenceDate!) && t.occurrenceDate! <= end) {
          await this.d.repos.tasks.update(t.id, instanceFields(next, t.occurrenceDate!));
          keep.add(occurrenceKey(series.id, t.occurrenceDate!));
        } else {
          await this.d.repos.tasks.remove(t.id);
        }
      }
      await this.generate(next, today, keep);
      return next;
    });
  }

  /** «Только эту задачу» при удалении — удаляется один экземпляр (он не будет создан заново, п. 6.6). */
  async deleteInstance(taskId: string): Promise<DeletionToken> {
    return this.tasks.delete(taskId);
  }

  /** «Всю серию» при удалении: серия и все её активные экземпляры от сегодня, включая исключения (п. 6.6, 6.12). */
  async deleteSeries(taskId: string): Promise<DeletionToken> {
    const today = this.d.clock.today();
    const instance = await this.tasks.require(taskId);
    if (!instance.seriesId) throw new Error('Это не экземпляр серии');
    const seriesId = instance.seriesId;
    return this.d.uow.run(async () => {
      await this.d.repos.taskSeries.softDelete(seriesId);
      const taskIds: string[] = [];
      for (const t of await this.d.repos.tasks.list()) {
        if (t.seriesId !== seriesId || t.status !== 'active' || t.plannedDate === null || t.plannedDate < today) continue;
        await this.d.repos.tasks.softDelete(t.id);
        taskIds.push(t.id);
      }
      return { taskIds, seriesIds: [seriesId] };
    });
  }

  /** Создаёт недостающие экземпляры от max(сегодня, первая дата) до горизонта. Вызывается внутри транзакции. */
  private async generate(series: TaskSeries, today: IsoDate, existing: Set<string>): Promise<Task[]> {
    const all = (await this.d.repos.tasks.list({ includeDeleted: true })).filter((t) => t.seriesId === series.id);
    for (const t of all) if (t.occurrenceDate) existing.add(occurrenceKey(series.id, t.occurrenceDate));
    const created: Task[] = [];
    for (const date of occurrences(series, today, horizonEnd(today))) {
      if (existing.has(occurrenceKey(series.id, date))) continue;
      const group = (await this.tasks.activeGroup(date)).sort(compareSortOrder);
      const last = group[group.length - 1];
      created.push(
        await this.d.repos.tasks.create({ ...instanceFields(series, date), sortOrder: generateKeyBetween(last ? last.sortOrder : null, null) }),
      );
    }
    return created;
  }

  private async requireSeries(id: string): Promise<TaskSeries> {
    const series = await this.d.repos.taskSeries.getById(id);
    if (!series) throw new Error('Серия не найдена');
    return series;
  }

  private async requireCategory(id: string): Promise<void> {
    if (!(await this.d.repos.categories.getById(id))) throw new Error('Категория не найдена');
  }
}
