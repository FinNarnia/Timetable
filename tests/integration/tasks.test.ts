import { describe, expect, it } from 'vitest';
import { CategoryValidationError, TaskValidationError } from '../../src/application/tasks';
import { emptyDraft, draftFromTask } from '../../src/domain/tasks';
import { makeEnv } from '../helpers';

async function readyEnv() {
  const env = makeEnv();
  await env.services.profile.start();
  await env.services.profile.create('Анна');
  return env;
}

const TODAY = '2026-10-09';

describe('задачи: создание и быстрое добавление (п. 6.7)', () => {
  it('быстрое добавление: сегодня, завтра, без даты', async () => {
    const { services } = await readyEnv();
    const a = await services.tasks.quickAdd('  Купить хлеб ', 'today');
    const b = await services.tasks.quickAdd('Позвонить', 'tomorrow');
    const c = await services.tasks.quickAdd('Прочитать', 'none');
    expect(a).toMatchObject({ title: 'Купить хлеб', scheduleType: 'date', plannedDate: TODAY, status: 'active', priority: 'normal' });
    expect(b).toMatchObject({ plannedDate: '2026-10-10', scheduleType: 'date' });
    expect(c).toMatchObject({ plannedDate: null, scheduleType: 'none', plannedTime: null });
    expect(await services.tasks.list()).toHaveLength(3);
  });

  it('новые задачи встают в конец группы', async () => {
    const { services } = await readyEnv();
    const a = await services.tasks.quickAdd('1', 'today');
    const b = await services.tasks.quickAdd('2', 'today');
    const c = await services.tasks.quickAdd('3', 'today');
    expect(a.sortOrder < b.sortOrder && b.sortOrder < c.sortOrder).toBe(true);
  });

  it('пустое название и время без даты — ошибка валидации, ничего не создаётся', async () => {
    const { services } = await readyEnv();
    await expect(services.tasks.quickAdd('   ', 'today')).rejects.toBeInstanceOf(TaskValidationError);
    const err = await services.tasks
      .create(emptyDraft({ title: 'X', scheduleType: 'none', plannedTime: '10:00' }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TaskValidationError);
    expect((err as TaskValidationError).errors.plannedTime).toBe('Время можно указать только вместе с датой');
    expect(await services.tasks.list()).toHaveLength(0);
  });

  it('расширенная форма: все поля сохраняются', async () => {
    const { services } = await readyEnv();
    const cat = await services.categories.create('Работа', 'blue');
    const t = await services.tasks.create(
      emptyDraft({
        title: 'Отчёт',
        note: 'Квартальный',
        scheduleType: 'datetime',
        plannedDate: TODAY,
        plannedTime: '15:30',
        priority: 'high',
        categoryId: cat.id,
      }),
    );
    expect(t).toMatchObject({ note: 'Квартальный', plannedTime: '15:30', priority: 'high', categoryId: cat.id });
  });

  it('несуществующая категория — ошибка', async () => {
    const { services } = await readyEnv();
    await expect(services.tasks.create(emptyDraft({ title: 'X', categoryId: 'nope' }))).rejects.toThrow('Категория не найдена');
  });
});

describe('задачи: редактирование (п. 6.8)', () => {
  it('ручная смена даты пишет TaskMove и ставит в конец нового дня', async () => {
    const { services, deps } = await readyEnv();
    const other = await services.tasks.quickAdd('Завтрашняя', 'tomorrow');
    const t = await services.tasks.quickAdd('Задача', 'today');
    const updated = await services.tasks.update(t.id, { ...draftFromTask(t), plannedDate: '2026-10-10' });
    expect(updated.plannedDate).toBe('2026-10-10');
    expect(updated.sortOrder > other.sortOrder).toBe(true);
    const moves = await deps.repos.taskMoves.list();
    expect(moves).toEqual([expect.objectContaining({ taskId: t.id, fromDate: TODAY, toDate: '2026-10-10', reason: 'manual' })]);
  });

  it('без смены даты TaskMove не пишется', async () => {
    const { services, deps } = await readyEnv();
    const t = await services.tasks.quickAdd('Задача', 'today');
    await services.tasks.update(t.id, { ...draftFromTask(t), title: 'Новое', priority: 'low' });
    expect(await deps.repos.taskMoves.list()).toHaveLength(0);
    expect((await services.tasks.list())[0]).toMatchObject({ title: 'Новое', priority: 'low' });
  });

  it('прошлая дата допустима, только если не менялась', async () => {
    const { services, clock } = await readyEnv();
    const t = await services.tasks.quickAdd('Вчерашняя', 'today');
    clock.advance(24 * 3600 * 1000);
    await expect(services.tasks.update(t.id, { ...draftFromTask(t), title: 'Ок' })).resolves.toMatchObject({ title: 'Ок' });
    await expect(
      services.tasks.update(t.id, { ...draftFromTask(t), plannedDate: '2026-10-01' }),
    ).rejects.toBeInstanceOf(TaskValidationError);
  });
});

describe('задачи: выполнение (п. 6.9)', () => {
  it('выполнить и снять отметку в тот же день', async () => {
    const { services } = await readyEnv();
    const t = await services.tasks.quickAdd('Задача', 'today');
    const done = await services.tasks.complete(t.id);
    expect(done.status).toBe('completed');
    expect(done.completedAt).not.toBeNull();
    const back = await services.tasks.uncomplete(t.id);
    expect(back).toMatchObject({ status: 'active', completedAt: null });
  });

  it('досрочное выполнение будущей задачи переносит её на сегодня', async () => {
    const { services } = await readyEnv();
    const t = await services.tasks.quickAdd('Завтрашняя', 'tomorrow');
    const done = await services.tasks.complete(t.id);
    expect(done).toMatchObject({ status: 'completed', plannedDate: TODAY });
  });

  it('задача без даты сохраняет пустую дату после выполнения', async () => {
    const { services } = await readyEnv();
    const t = await services.tasks.quickAdd('Без даты', 'none');
    expect(await services.tasks.complete(t.id)).toMatchObject({ status: 'completed', plannedDate: null });
  });

  it('на следующий день снять отметку нельзя', async () => {
    const { services, clock } = await readyEnv();
    const t = await services.tasks.quickAdd('Задача', 'today');
    await services.tasks.complete(t.id);
    clock.advance(24 * 3600 * 1000);
    await expect(services.tasks.uncomplete(t.id)).rejects.toThrow('только в день выполнения');
  });
});

describe('задачи: дублирование (п. 6.11)', () => {
  it('копия встаёт сразу после оригинала и независима', async () => {
    const { services } = await readyEnv();
    const a = await services.tasks.quickAdd('A', 'today');
    const b = await services.tasks.quickAdd('B', 'today');
    const copy = await services.tasks.duplicate(a.id);
    expect(copy.id).not.toBe(a.id);
    expect(copy.title).toBe('A');
    expect(a.sortOrder < copy.sortOrder && copy.sortOrder < b.sortOrder).toBe(true);
    await services.tasks.update(copy.id, { ...draftFromTask(copy), title: 'Копия' });
    const original = (await services.tasks.list()).find((t) => t.id === a.id);
    expect(original?.title).toBe('A');
  });

  it('копия выполненной задачи — активная, в конце группы', async () => {
    const { services } = await readyEnv();
    const a = await services.tasks.quickAdd('A', 'today');
    const b = await services.tasks.quickAdd('B', 'today');
    await services.tasks.complete(a.id);
    const copy = await services.tasks.duplicate(a.id);
    expect(copy).toMatchObject({ status: 'active', completedAt: null });
    expect(copy.sortOrder > b.sortOrder).toBe(true);
  });

  it('копия задачи с прошедшей датой получает сегодняшнюю', async () => {
    const { services, clock } = await readyEnv();
    const a = await services.tasks.quickAdd('A', 'today');
    clock.advance(2 * 24 * 3600 * 1000);
    const copy = await services.tasks.duplicate(a.id);
    expect(copy.plannedDate).toBe('2026-10-11');
  });
});

describe('задачи: удаление и отмена (п. 6.12)', () => {
  it('мягкое удаление скрывает задачу, отмена возвращает её', async () => {
    const { services, deps } = await readyEnv();
    const t = await services.tasks.quickAdd('Задача', 'today');
    const token = await services.tasks.delete(t.id);
    expect(await services.tasks.list()).toHaveLength(0);
    const raw = await deps.repos.tasks.getById(t.id, { includeDeleted: true });
    expect(raw?.deletedAt).not.toBeNull();
    await services.tasks.undoDelete(token);
    const back = await services.tasks.list();
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ id: t.id, title: 'Задача', sortOrder: t.sortOrder, deletedAt: null });
  });

  it('удаление сохраняется после «перезагрузки»', async () => {
    const { services, deps, dbName } = await readyEnv();
    const t = await services.tasks.quickAdd('Задача', 'today');
    await services.tasks.quickAdd('Другая', 'today');
    await services.tasks.delete(t.id);
    deps.db.close();
    const again = makeEnv(dbName);
    await again.services.profile.start();
    const list = await again.services.tasks.list();
    expect(list.map((x) => x.title)).toEqual(['Другая']);
  });
});

describe('категории (п. 6.4, 10.4)', () => {
  it('CRUD: создать, переименовать, сменить цвет', async () => {
    const { services } = await readyEnv();
    const c = await services.categories.create('  Дом ', 'green');
    expect(c).toMatchObject({ name: 'Дом', normalizedName: 'дом', color: 'green' });
    await services.categories.rename(c.id, 'Семья');
    await services.categories.recolor(c.id, 'rose');
    expect(await services.categories.list()).toEqual([expect.objectContaining({ name: 'Семья', color: 'rose' })]);
  });

  it('уникальность без учёта регистра и ё/е', async () => {
    const { services } = await readyEnv();
    await services.categories.create('Ёлка', 'green');
    await expect(services.categories.create('елка', 'blue')).rejects.toBeInstanceOf(CategoryValidationError);
    await expect(services.categories.create('ЁЛКА', 'blue')).rejects.toThrow('Категория с таким названием уже есть');
    const other = await services.categories.create('Работа', 'blue');
    await expect(services.categories.rename(other.id, 'елка')).rejects.toBeInstanceOf(CategoryValidationError);
  });

  it('переименование в то же название с другим регистром разрешено', async () => {
    const { services } = await readyEnv();
    const c = await services.categories.create('дом', 'green');
    await expect(services.categories.rename(c.id, 'Дом')).resolves.toMatchObject({ name: 'Дом' });
  });

  it('удаление категории обнуляет её у задач (в т. ч. удалённых) и разрешает имя снова', async () => {
    const { services, deps } = await readyEnv();
    const c = await services.categories.create('Работа', 'blue');
    const t1 = await services.tasks.create(emptyDraft({ title: 'A', scheduleType: 'date', plannedDate: TODAY, categoryId: c.id }));
    const t2 = await services.tasks.create(emptyDraft({ title: 'B', categoryId: c.id }));
    const t3 = await services.tasks.create(emptyDraft({ title: 'C', categoryId: c.id }));
    const token = await services.tasks.delete(t3.id);
    expect((await services.categories.listWithCounts())[0]?.taskCount).toBe(2);

    await services.categories.delete(c.id);
    expect(await services.categories.list()).toHaveLength(0);
    const tasks = await services.tasks.list();
    expect(tasks).toHaveLength(2);
    expect(tasks.every((t) => t.categoryId === null)).toBe(true);
    expect([t1.id, t2.id].sort()).toEqual(tasks.map((t) => t.id).sort());

    await services.tasks.undoDelete(token);
    const restored = await deps.repos.tasks.getById(t3.id);
    expect(restored?.categoryId).toBeNull();

    await expect(services.categories.create('Работа', 'olive')).resolves.toMatchObject({ name: 'Работа' });
  });
});
