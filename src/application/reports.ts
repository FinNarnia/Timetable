import { addDaysIso, localDateOf, localDayStartIso } from '../domain/dates';
import { compareHabits, sortedVersions } from '../domain/habits';
import { buildReport, checksWindow, periodBounds, type Report, type ReportPeriod } from '../domain/reports';
import type { HabitSchedule } from '../domain/types';
import type { AppDeps } from './services';

/**
 * Отчёты (раздел 9): читает только данные периода по индексам и считает в Domain.
 * Задачи и переносы читаются вместе с удалёнными — прошлое удаление не переписывает (п. 6.12, 9.2).
 */
export class ReportService {
  constructor(private readonly d: AppDeps) {}

  async build(period: ReportPeriod): Promise<Report> {
    const { repos, clock } = this.d;
    const today = clock.today();
    const { start, end } = periodBounds(period);
    const window = checksWindow(period);
    const [profile, planned, completedIds, moves, habits, schedules, checks] = await Promise.all([
      repos.profile.get(),
      repos.tasks.listPlannedBetween(start, end),
      repos.tasks.idsCompletedBetween(localDayStartIso(start), localDayStartIso(addDaysIso(end, 1))),
      repos.taskMoves.listFromBetween(start, end),
      repos.habits.list(),
      repos.habitSchedules.list(),
      repos.habitChecks.listBetween(window.from, window.to),
    ]);
    if (!profile) throw new Error('Профиль не найден');
    // Выполненные в периоде: с датой в периоде уже прочитаны; дочитываем только остальные (без срока и досрочные экземпляры).
    const seen = new Set(planned.map((t) => t.id));
    const completed = await repos.tasks.getMany(completedIds.filter((id) => !seen.has(id)));
    const byHabit = new Map<string, HabitSchedule[]>();
    for (const s of schedules) {
      const list = byHabit.get(s.habitId) ?? [];
      list.push(s);
      byHabit.set(s.habitId, list);
    }
    return buildReport(period, {
      today,
      profileCreated: localDateOf(profile.createdAt),
      tasks: [...planned, ...completed.filter((t) => t.plannedDate === null)],
      moves,
      habits: [...habits]
        // Активные по общему порядку, затем архивные.
        .sort((a, b) => Number(a.archivedAt !== null) - Number(b.archivedAt !== null) || compareHabits(a, b))
        .map((habit) => ({ habit, versions: sortedVersions(byHabit.get(habit.id) ?? []) })),
      checks,
    });
  }
}
