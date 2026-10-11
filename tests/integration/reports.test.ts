import { describe, expect, it } from 'vitest';
import { emptyHabitDraft } from '../../src/domain/habits';
import { parsePeriod } from '../../src/domain/reports';
import { emptyDraft } from '../../src/domain/tasks';
import { makeEnv } from '../helpers';
import { actualFor, caseData, habitNames, REPORT_CASES } from '../reportFixtures';

const DAY = 24 * 3600 * 1000;

describe('отчёты на сохранённых данных совпадают с эталонным набором (п. 16.1)', () => {
  for (const c of REPORT_CASES) {
    it(`${c.id}: ${c.title}`, async () => {
      const env = makeEnv();
      const [y, m, d] = c.today.split('-').map(Number) as [number, number, number];
      env.clock.set(new Date(y, m - 1, d, 15, 0));
      await env.services.profile.start();
      await env.services.data.importBackup(caseData(c));
      for (const r of c.reports) {
        const report = await env.services.reports.build(parsePeriod(r.period));
        expect(actualFor(report, r.expected, habitNames(c)), r.period).toEqual(r.expected);
      }
    });
  }
});

describe('отчёты в живом сценарии', () => {
  it('удаление задачи и смена расписания не меняют прошлую неделю; удаление сегодня убирает задачу из сегодняшнего дня', async () => {
    const env = makeEnv(); // пт, 9 окт 2026
    const s = env.services;
    await s.profile.start();
    await s.profile.create('Анна');
    const done = await s.tasks.create(emptyDraft({ title: 'Сделана', scheduleType: 'date', plannedDate: '2026-10-09' }));
    await s.tasks.complete(done.id);
    const late = await s.tasks.create(emptyDraft({ title: 'Висит', scheduleType: 'date', plannedDate: '2026-10-09' }));
    const habit = await s.habits.create(emptyHabitDraft({ title: 'Бассейн', type: 'weekdays', weekdays: [1, 3, 5] }));
    await s.habits.toggleCheck(habit.id, '2026-10-09');

    env.clock.advance(3 * DAY); // пн, 12 окт: автоперенос 09 → 12
    await s.day.maintain();
    const week = parsePeriod('week:2026-10-05');
    const before = await s.reports.build(week);
    expect(before.tasks).toMatchObject({ planned: 2, done: 1, missed: 1, autoMoves: 1, percent: 50 });
    expect(before.habits).toMatchObject({ planned: 1, done: 1 });

    await s.tasks.delete(late.id);
    await s.tasks.delete(done.id);
    await s.habits.update(habit.id, emptyHabitDraft({ title: 'Плавание', type: 'weekdays', weekdays: [2, 4] }));
    const after = await s.reports.build(week);
    expect(after.tasks).toEqual(before.tasks);
    expect(after.habits).toEqual(before.habits);
    expect(after.habitRows.map((r) => r.title)).toEqual(['Плавание']); // название меняется во всех отчётах (п. 8.5)

    const current = await s.reports.build(parsePeriod('week:2026-10-12'));
    expect(current.tasks).toMatchObject({ planned: 0, percent: null }); // удалённая сегодня не считается
  });
});
