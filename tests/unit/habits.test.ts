import { describe, expect, it } from 'vitest';
import {
  archivedAtFor,
  checkBlock,
  checkedDates,
  circleFor,
  emptyHabitDraft,
  isPlannedOn,
  mondayOf,
  monthOfWeek,
  scheduleSummary,
  showOnToday,
  sortedVersions,
  validateHabitDraft,
  versionOn,
  weekCounterText,
  weekDates,
  weekTarget,
} from '../../src/domain/habits';
import type { HabitCheck, HabitSchedule } from '../../src/domain/types';

const TODAY = '2026-10-14'; // среда
const base = { userId: 'u', rev: 1, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', deletedAt: null };
let n = 0;
function v(effectiveFrom: string, fields: Partial<HabitSchedule> = {}): HabitSchedule {
  n++;
  return { ...base, id: `v${n}`, habitId: 'h', effectiveFrom, active: true, type: 'daily', weekdays: [], weeklyTarget: null, ...fields };
}
const check = (date: string, deleted = false): HabitCheck => ({ ...base, id: `c${date}`, habitId: 'h', date, deletedAt: deleted ? 'x' : null });

describe('форма привычки (п. 8.1–8.2)', () => {
  it('название 1–60 символов, обрезка пробелов', () => {
    expect(validateHabitDraft(emptyHabitDraft({ title: '  ' }))).toEqual({ ok: false, errors: { title: 'Введите название привычки' } });
    expect(validateHabitDraft(emptyHabitDraft({ title: 'я'.repeat(61) })).ok).toBe(false);
    expect(validateHabitDraft(emptyHabitDraft({ title: ` ${'я'.repeat(60)} ` }))).toMatchObject({ ok: true, title: 'я'.repeat(60) });
  });

  it('по дням недели: минимум один день; все 7 — это «Каждый день»', () => {
    expect(validateHabitDraft(emptyHabitDraft({ title: 'А', type: 'weekdays' }))).toEqual({
      ok: false,
      errors: { weekdays: 'Выберите хотя бы один день недели' },
    });
    expect(validateHabitDraft(emptyHabitDraft({ title: 'А', type: 'weekdays', weekdays: [5, 1, 1, 9] }))).toMatchObject({
      ok: true,
      schedule: { type: 'weekdays', weekdays: [1, 5], weeklyTarget: null },
    });
    expect(validateHabitDraft(emptyHabitDraft({ title: 'А', type: 'weekdays', weekdays: [1, 2, 3, 4, 5, 6, 7] }))).toMatchObject({
      ok: true,
      schedule: { type: 'daily', weekdays: [] },
    });
  });

  it('цель на неделю: 1–6, по умолчанию 3', () => {
    expect(emptyHabitDraft().weeklyTarget).toBe(3);
    for (const bad of [0, 7, 2.5]) {
      expect(validateHabitDraft(emptyHabitDraft({ title: 'А', type: 'weekly_target', weeklyTarget: bad }))).toEqual({
        ok: false,
        errors: { weeklyTarget: 'Цель — от 1 до 6 раз в неделю' },
      });
    }
    expect(validateHabitDraft(emptyHabitDraft({ title: 'А', type: 'weekly_target', weeklyTarget: 6 }))).toMatchObject({
      ok: true,
      schedule: { type: 'weekly_target', weeklyTarget: 6 },
    });
  });
});

describe('версии расписания (п. 8.5, 13.8)', () => {
  const versions = sortedVersions([
    v('2026-10-12', { type: 'weekdays', weekdays: [2, 4] }),
    v('2026-10-01', { type: 'weekdays', weekdays: [1, 3, 5] }),
    v('2026-09-30', { type: 'daily', deletedAt: 'x' }),
  ]);

  it('действует версия с наибольшим effectiveFrom ≤ D; удалённые не учитываются', () => {
    expect(versionOn(versions, '2026-09-30')).toBeUndefined();
    expect(versionOn(versions, '2026-10-11')!.weekdays).toEqual([1, 3, 5]);
    expect(versionOn(versions, '2026-10-12')!.weekdays).toEqual([2, 4]);
  });

  it('запланированные дни прошлой недели — по старой версии, этой — по новой (11.15)', () => {
    const last = weekDates('2026-10-05').filter((d) => isPlannedOn(versions, d));
    const current = weekDates('2026-10-12').filter((d) => isPlannedOn(versions, d));
    expect(last).toEqual(['2026-10-05', '2026-10-07', '2026-10-09']);
    expect(current).toEqual(['2026-10-13', '2026-10-15']);
  });

  it('архив и возврат: в архиве день не запланирован; archivedAt — производное поле', () => {
    const vs = sortedVersions([v('2026-10-01'), v('2026-10-08', { active: false }), v('2026-10-11')]);
    expect(isPlannedOn(vs, '2026-10-07')).toBe(true);
    expect(isPlannedOn(vs, '2026-10-08')).toBe(false); // день архивирования в план не входит
    expect(isPlannedOn(vs, '2026-10-10')).toBe(false);
    expect(isPlannedOn(vs, '2026-10-11')).toBe(true); // с дня возврата
    expect(archivedAtFor(vs)).toBeNull();
    expect(archivedAtFor(vs.slice(0, 2))).toBe('2026-10-08');
    expect(archivedAtFor([])).toBeNull();
  });
});

describe(`окно отметок: сегодня и 3 предыдущих дня (п. 8.4)`, () => {
  const daily = [v('2026-10-01')];

  it('границы окна', () => {
    expect(checkBlock(daily, TODAY, TODAY)).toBeNull();
    expect(checkBlock(daily, '2026-10-11', TODAY)).toBeNull(); // 3 дня назад
    expect(checkBlock(daily, '2026-10-10', TODAY)).toBe('too-old'); // 4 дня назад
    expect(checkBlock(daily, '2026-10-15', TODAY)).toBe('future');
  });

  it('не раньше даты создания, не в архиве, только запланированные дни', () => {
    expect(checkBlock([v('2026-10-13')], '2026-10-12', TODAY)).toBe('before-created');
    expect(checkBlock(sortedVersions([v('2026-10-01'), v('2026-10-13', { active: false })]), TODAY, TODAY)).toBe('archived');
    expect(checkBlock([v('2026-10-01', { type: 'weekdays', weekdays: [1] })], TODAY, TODAY)).toBe('not-planned');
    expect(checkBlock([v('2026-10-01', { type: 'weekly_target', weeklyTarget: 2 })], TODAY, TODAY)).toBeNull();
  });

  it('состояния кругов', () => {
    const weekdays = [v('2026-10-01', { type: 'weekdays', weekdays: [1, 3, 5] })];
    expect(circleFor(weekdays, '2026-10-12', TODAY, true).state).toBe('done');
    expect(circleFor(weekdays, TODAY, TODAY, false)).toEqual({ date: TODAY, state: 'open', block: null });
    expect(circleFor(weekdays, '2026-10-13', TODAY, false).state).toBe('unplanned');
    expect(circleFor(weekdays, '2026-10-16', TODAY, false)).toMatchObject({ state: 'unavailable', block: 'future' });
    expect(circleFor(weekdays, '2026-10-07', TODAY, false)).toMatchObject({ state: 'unavailable', block: 'too-old' });
    // Отметка на день, ставший незапланированным, сохраняется и видна как «выполнено» (п. 8.5).
    expect(circleFor(weekdays, '2026-10-13', TODAY, true)).toMatchObject({ state: 'done', block: 'not-planned' });
  });

  it('снятые отметки не считаются', () => {
    expect([...checkedDates([check('2026-10-12'), check('2026-10-13', true)], 'h')]).toEqual(['2026-10-12']);
  });
});

describe('цель на неделю (п. 8.3, 9.3)', () => {
  it('цель берётся из версии понедельника; неполная неделя — не больше активных дней', () => {
    const vs = sortedVersions([v('2026-10-01', { type: 'weekly_target', weeklyTarget: 3 }), v('2026-10-14', { type: 'weekly_target', weeklyTarget: 5 })]);
    expect(weekTarget(vs, '2026-10-12')).toBe(3);
    expect(weekTarget(vs, '2026-10-19')).toBe(5);
    // Создана в субботу — активных дней в неделе 2, цель 5 → 2.
    expect(weekTarget([v('2026-10-17', { type: 'weekly_target', weeklyTarget: 5 })], '2026-10-12')).toBe(2);
    expect(weekTarget([v('2026-10-01')], '2026-10-12')).toBeNull();
  });

  it('счётчик: «2 из 3», «Цель недели выполнена», сверх цели — «4 из 3»', () => {
    expect(weekCounterText(0, 3)).toBe('0 из 3');
    expect(weekCounterText(2, 3)).toBe('2 из 3');
    expect(weekCounterText(3, 3)).toBe('Цель недели выполнена');
    expect(weekCounterText(4, 3)).toBe('4 из 3');
  });

  it('неделя на стыке месяцев относится к месяцу своего четверга', () => {
    expect(monthOfWeek('2026-09-28')).toBe('2026-10'); // пн 28 сен — чт 1 окт
    expect(monthOfWeek('2026-10-26')).toBe('2026-10'); // чт 29 окт
    expect(monthOfWeek('2026-11-30')).toBe('2026-12'); // чт 3 дек
    expect(monthOfWeek('2025-12-29')).toBe('2026-01'); // через новый год
  });

  it('понедельник недели и её дни', () => {
    expect(mondayOf('2026-10-18')).toBe('2026-10-12');
    expect(mondayOf('2026-10-12')).toBe('2026-10-12');
    expect(weekDates('2026-10-12')).toHaveLength(7);
  });
});

describe('блок «Привычки на сегодня» (п. 7.1)', () => {
  it('каждый день и запланированные по дням недели', () => {
    expect(showOnToday([v('2026-10-01')], new Set(), TODAY)).toBe(true);
    expect(showOnToday([v('2026-10-01', { type: 'weekdays', weekdays: [3] })], new Set(), TODAY)).toBe(true);
    expect(showOnToday([v('2026-10-01', { type: 'weekdays', weekdays: [1] })], new Set(), TODAY)).toBe(false);
    expect(showOnToday(sortedVersions([v('2026-10-01'), v('2026-10-13', { active: false })]), new Set(), TODAY)).toBe(false);
  });

  it('цель на неделю: пока цель не достигнута или если отмечена сегодня', () => {
    const vs = [v('2026-10-01', { type: 'weekly_target', weeklyTarget: 2 })];
    expect(showOnToday(vs, new Set(['2026-10-12']), TODAY)).toBe(true);
    expect(showOnToday(vs, new Set(['2026-10-12', '2026-10-13']), TODAY)).toBe(false);
    expect(showOnToday(vs, new Set(['2026-10-12', TODAY]), TODAY)).toBe(true);
  });

  it('описание расписания', () => {
    expect(scheduleSummary(undefined)).toBe('Каждый день');
    expect(scheduleSummary({ type: 'weekdays', weekdays: [1, 3, 5], weeklyTarget: null })).toBe('пн, ср, пт');
    expect(scheduleSummary({ type: 'weekly_target', weekdays: [], weeklyTarget: 1 })).toBe('1 раз в неделю');
    expect(scheduleSummary({ type: 'weekly_target', weekdays: [], weeklyTarget: 3 })).toBe('3 раза в неделю');
    expect(scheduleSummary({ type: 'weekly_target', weekdays: [], weeklyTarget: 5 })).toBe('5 раз в неделю');
  });
});

describe('подписи дат привычек', async () => {
  const { formatWeekdayDayMonth, formatWeekRange } = await import('../../src/domain/dates');
  it('«Вторник, 14 октября» и диапазон недели', () => {
    expect(formatWeekdayDayMonth('2026-10-13')).toBe('Вторник, 13 октября');
    expect(formatWeekRange('2026-10-12')).toBe('12–18 октября');
    expect(formatWeekRange('2026-09-28')).toBe('28 сентября — 4 октября');
  });
});

describe('черновик формы и последняя активная версия', async () => {
  const { draftFromHabit, lastActiveVersion, latestVersion, creationDate } = await import('../../src/domain/habits');
  const habit = { ...base, id: 'h', title: 'Бассейн', sortOrder: 'a0', archivedAt: null };
  it('черновик из привычки по текущему расписанию', () => {
    expect(draftFromHabit(habit, { type: 'weekdays', weekdays: [2, 4], weeklyTarget: null })).toEqual({
      title: 'Бассейн',
      type: 'weekdays',
      weekdays: [2, 4],
      weeklyTarget: 3,
    });
    expect(draftFromHabit(habit, { type: 'weekly_target', weekdays: [], weeklyTarget: 5 })).toMatchObject({ type: 'weekly_target', weekdays: [], weeklyTarget: 5 });
    expect(draftFromHabit(habit, undefined)).toMatchObject({ type: 'daily', weeklyTarget: 3 });
  });
  it('последняя активная версия пропускает архивные; дата создания — первая версия', () => {
    const vs = sortedVersions([v('2026-10-01', { weeklyTarget: 2 }), v('2026-10-08', { active: false }), v('2026-10-09', { active: false })]);
    expect(lastActiveVersion(vs)!.effectiveFrom).toBe('2026-10-01');
    expect(latestVersion(vs)!.effectiveFrom).toBe('2026-10-09');
    expect(lastActiveVersion([v('2026-10-01', { active: false })])).toBeUndefined();
    expect(creationDate(vs)).toBe('2026-10-01');
    expect(creationDate([])).toBeUndefined();
  });
});
