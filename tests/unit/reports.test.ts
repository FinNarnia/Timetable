import { describe, expect, it } from 'vitest';
import { localDateOf } from '../../src/domain/dates';
import { sortedVersions } from '../../src/domain/habits';
import {
  buildReport,
  cellLabel,
  cellLevel,
  checksWindow,
  currentPeriod,
  parsePeriod,
  percentOf,
  periodTitle,
  periodWeeks,
  shiftPeriod,
  type ReportInput,
} from '../../src/domain/reports';
import type { DataSet } from '../../src/domain/types';
import { actualFor, caseData, habitNames, localIso, REPORT_CASES } from '../reportFixtures';

function inputOf(data: DataSet, today: string): ReportInput {
  return {
    today,
    profileCreated: localDateOf(data.profile.createdAt),
    tasks: data.tasks,
    moves: data.taskMoves,
    habits: data.habits.map((habit) => ({ habit, versions: sortedVersions(data.habitSchedules.filter((s) => s.habitId === habit.id)) })),
    checks: data.habitChecks,
  };
}

describe('эталонный набор отчётов (fixtures/reports, п. 16.1)', () => {
  it('в наборе не меньше 20 случаев', () => {
    expect(REPORT_CASES.length).toBeGreaterThanOrEqual(20);
  });

  for (const c of REPORT_CASES) {
    for (const r of c.reports) {
      it(`${c.id} ${r.period}: ${c.title}`, () => {
        const data = caseData(c);
        const report = buildReport(parsePeriod(r.period), inputOf(data, c.today));
        expect(actualFor(report, r.expected, habitNames(c))).toEqual(r.expected);
      });
    }
  }
});

describe('правила расчёта (п. 9.1–9.3)', () => {
  it('округление 0,5 вверх; «—» при нулевом знаменателе', () => {
    expect(percentOf(1, 8)).toBe(13);
    expect(percentOf(5, 8)).toBe(63);
    expect(percentOf(3, 8)).toBe(38);
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(2, 3)).toBe(67);
    expect(percentOf(29, 200)).toBe(15); // 14,5 → 15
    expect(percentOf(0, 0)).toBeNull();
  });

  it('уровни ячейки по округлённому проценту', () => {
    expect([0, 24, 25, 49, 50, 74, 75, 100].map(cellLevel)).toEqual(['0-24', '0-24', '25-49', '25-49', '50-74', '50-74', '75-100', '75-100']);
    expect(cellLevel(percentOf(49, 200)!)).toBe('25-49'); // 24,5% → 25%
  });

  it('удаление задачи в тот же прошедший день — день закончился без неё; позже — остаётся в прошлом', () => {
    const c = {
      id: 'X',
      title: '',
      today: '2026-10-14',
      profileCreated: '2026-09-01',
      tasks: [
        { id: 'a', date: '2026-10-12', status: 'completed' as const, completed: '2026-10-12 10:00', deleted: '2026-10-12 11:00' },
        { id: 'b', date: '2026-10-12', status: 'completed' as const, completed: '2026-10-12 10:00', deleted: '2026-10-13 00:01' },
        { id: 'u', date: null, status: 'completed' as const, completed: '2026-10-12 10:00', deleted: '2026-10-12 23:59' },
      ],
      reports: [],
    };
    const report = buildReport(parsePeriod('week:2026-10-12'), inputOf(caseData(c), c.today));
    expect(report.tasks).toMatchObject({ done: 1, planned: 1, doneUndated: 0 });
    expect(localIso('2026-10-12 11:00') < localIso('2026-10-13 00:00')).toBe(true);
  });

  it('периоды: текущий, сдвиг, заголовки, недели месяца по четвергу', () => {
    expect(currentPeriod('week', '2026-10-14')).toEqual({ kind: 'week', monday: '2026-10-12' });
    expect(currentPeriod('month', '2026-10-14')).toEqual({ kind: 'month', month: '2026-10' });
    expect(shiftPeriod({ kind: 'month', month: '2026-01' }, -1)).toEqual({ kind: 'month', month: '2025-12' });
    expect(shiftPeriod({ kind: 'month', month: '2026-12' }, 1)).toEqual({ kind: 'month', month: '2027-01' });
    expect(shiftPeriod({ kind: 'week', monday: '2026-10-05' }, 1)).toEqual({ kind: 'week', monday: '2026-10-12' });
    expect(periodTitle({ kind: 'week', monday: '2026-10-05' })).toBe('пн, 5 окт — вс, 11 окт 2026');
    expect(periodTitle({ kind: 'week', monday: '2025-12-29' })).toBe('пн, 29 дек 2025 — вс, 4 янв 2026');
    expect(periodTitle({ kind: 'month', month: '2026-10' })).toBe('Октябрь 2026');
    expect(periodWeeks({ kind: 'month', month: '2026-10' })).toEqual(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
    expect(checksWindow({ kind: 'month', month: '2026-10' })).toEqual({ from: '2026-09-28', to: '2026-11-01' });
    expect(checksWindow({ kind: 'month', month: '2026-11' })).toEqual({ from: '2026-11-01', to: '2026-11-30' }); // 30.11 — пн, его неделя уходит в декабрь;
    expect(checksWindow({ kind: 'week', monday: '2026-10-05' })).toEqual({ from: '2026-10-05', to: '2026-10-11' });
  });

  it('подписи ячеек: «до начала»', () => {
    const c = REPORT_CASES.find((x) => x.id === 'R08')!;
    const report = buildReport(parsePeriod('month:2026-10'), inputOf(caseData(c), c.today));
    expect(cellLabel(report.days[0]!)).toBe('1 октября: до начала');
  });

  it('отметки в строке привычки недели: засчитана, лишняя, пропуск, сегодня, вне плана, архив, впереди', () => {
    const c = {
      id: 'Y',
      title: '',
      today: '2026-10-14',
      profileCreated: '2026-09-01',
      habits: [
        { id: 'w', title: 'Бассейн', versions: [{ from: '2026-09-01', type: 'weekdays' as const, weekdays: [1, 2, 3] }], checks: ['2026-10-12', '2026-10-13'] },
        { id: 'g', title: 'Бег', versions: [{ from: '2026-10-13', type: 'weekly_target' as const, target: 2 }], checks: ['2026-10-14'] },
        { id: 'e', title: 'Йога', versions: [{ from: '2026-09-01', type: 'weekdays' as const, weekdays: [5] }], checks: ['2026-10-12'] },
      ],
      reports: [],
    };
    const report = buildReport(parsePeriod('week:2026-10-12'), inputOf(caseData(c), c.today));
    const marks = report.habitRows.map((r) => r.marks.map((m) => m.state).join(' '));
    expect(marks).toEqual([
      'done done open ahead ahead ahead ahead',
      'inactive free done ahead ahead ahead ahead',
      'extra off off ahead ahead ahead ahead',
    ]);
    expect(report.habitRows[1]!.text).toBe('1 из 2, неделя идёт');
  });
});
