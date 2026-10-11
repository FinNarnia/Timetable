import { describe, expect, it } from 'vitest';
import { emptyDraft } from '../../src/domain/tasks';
import { FakeNotifier, makeEnv } from '../helpers';

const at = (iso: string) => new Date(iso); // локальное время

async function ready(dbName?: string, notifier = new FakeNotifier()) {
  const env = makeEnv(dbName, notifier);
  env.clock.set(at('2026-10-14T19:00:00'));
  await env.services.profile.start();
  return { ...env, notifier };
}

describe('вечернее уведомление (п. 10.1, 11.18)', () => {
  it('с 20:00 один раз в день, «На завтра 2 задачи», первые названия; системное — если вкладка не в фокусе', async () => {
    const env = await ready();
    const s = env.services;
    await s.profile.create('Анна');
    for (const title of ['Позвонить', 'Купить хлеб']) await s.tasks.create(emptyDraft({ title, scheduleType: 'date', plannedDate: '2026-10-15' }));
    const done = await s.tasks.create(emptyDraft({ title: 'Уже сделано', scheduleType: 'date', plannedDate: '2026-10-15' }));
    await s.tasks.complete(done.id); // досрочно: переехала на сегодня

    expect(await s.reminder.check(() => {})).toBeNull(); // 19:00 — рано
    env.clock.set(at('2026-10-14T20:40:00'));
    const shown = await s.reminder.check(() => {});
    expect(shown).toEqual({ title: 'На завтра 2 задачи', titles: ['Позвонить', 'Купить хлеб'], count: 2 });
    expect(env.notifier.shown).toHaveLength(1);
    expect(env.notifier.shown[0]).toMatchObject({ title: 'На завтра 2 задачи', body: 'Позвонить\nКупить хлеб' });
    expect(await s.reminder.shownToday()).toBe(true);

    env.clock.set(at('2026-10-14T21:00:00'));
    expect(await s.reminder.check(() => {})).toBeNull(); // повторно — нет
    env.clock.set(at('2026-10-15T20:30:00'));
    expect(await s.reminder.shownToday()).toBe(false);
  });

  it('вкладка в фокусе — только внутреннее; без разрешения системное не показывается', async () => {
    const focused = await ready(undefined, new FakeNotifier('granted', false));
    await focused.services.profile.create('Анна');
    await focused.services.tasks.create(emptyDraft({ title: 'А', scheduleType: 'date', plannedDate: '2026-10-15' }));
    focused.clock.set(at('2026-10-14T20:00:00'));
    expect(await focused.services.reminder.check(() => {})).not.toBeNull();
    expect(focused.notifier.shown).toHaveLength(0);

    const denied = await ready(undefined, new FakeNotifier('denied', true));
    await denied.services.profile.create('Борис');
    await denied.services.tasks.create(emptyDraft({ title: 'Б', scheduleType: 'date', plannedDate: '2026-10-15' }));
    denied.clock.set(at('2026-10-14T20:00:00'));
    expect(await denied.services.reminder.check(() => {})).not.toBeNull();
    expect(denied.notifier.shown).toHaveLength(0);
  });

  it('нет задач на завтра, выключено, другое время — не показывается', async () => {
    const env = await ready();
    const s = env.services;
    await s.profile.create('Анна');
    env.clock.set(at('2026-10-14T22:00:00'));
    expect(await s.reminder.check(() => {})).toBeNull();
    await s.tasks.create(emptyDraft({ title: 'А', scheduleType: 'date', plannedDate: '2026-10-15' }));
    await s.reminder.setEnabled(false);
    expect(await s.reminder.check(() => {})).toBeNull();
    await s.reminder.setEnabled(true);
    await s.reminder.setTime('23:30');
    expect(await s.reminder.check(() => {})).toBeNull();
    await expect(s.reminder.setTime('17:00')).rejects.toThrow();
    await s.reminder.setTime('21:30');
    expect(await s.reminder.check(() => {})).not.toBeNull();
  });

  it('две вкладки одновременно: показ ровно один раз (п. 10.3)', async () => {
    const dbName = `two-tabs-${Math.random()}`;
    const a = await ready(dbName);
    await a.services.profile.create('Анна');
    await a.services.tasks.create(emptyDraft({ title: 'А', scheduleType: 'date', plannedDate: '2026-10-15' }));
    const b = await ready(dbName);
    for (const env of [a, b]) env.clock.set(at('2026-10-14T20:40:00'));
    const results = await Promise.all([a.services.reminder.check(() => {}), b.services.reminder.check(() => {})]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(a.notifier.shown.length + b.notifier.shown.length).toBe(1);
  });

  it('разрешение браузера запрашивается только по действию и отражается в статусе', async () => {
    const env = await ready(undefined, new FakeNotifier('default'));
    expect(env.services.reminder.permission()).toBe('default');
    expect(await env.services.reminder.requestPermission()).toBe('granted');
  });
});

describe('плашка о резервной копии (п. 4.3)', () => {
  it('через 8 дней без копии; после «Не сейчас» — снова через 7 дней; после копии — нет', async () => {
    const env = await ready();
    const s = env.services;
    await s.profile.create('Анна'); // 14 окт
    expect(await s.reminder.backupBanner()).toBeNull();
    env.clock.set(at('2026-10-22T10:00:00'));
    expect(await s.reminder.backupBanner()).toBe('never');
    await s.reminder.dismissBackupBanner();
    expect(await s.reminder.backupBanner()).toBeNull();
    env.clock.set(at('2026-10-29T10:00:00'));
    expect(await s.reminder.backupBanner()).toBe('never');
    await s.data.markExported();
    expect(await s.reminder.backupBanner()).toBeNull();
  });
});
