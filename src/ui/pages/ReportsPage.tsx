import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { formatWeekdayDayMonth } from '../../domain/dates';
import {
  cellLabel,
  currentPeriod,
  LEVEL_TEXT,
  NO_PLAN_TEXT,
  periodTitle,
  shiftPeriod,
  type HabitRow,
  type MarkState,
  type Report,
  type ReportDay,
  type ReportKind,
  type ReportPeriod,
} from '../../domain/reports';
import { Segmented } from '../components/TaskFormDialog';
import { useAppStore, useServices } from '../state';

const WEEKDAY_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

/** Отчёт периода; перечитывается при смене дня и изменениях данных в любой вкладке. */
function useReport(period: ReportPeriod) {
  const services = useServices();
  const dataVersion = useAppStore((s) => s.dataVersion);
  const today = useAppStore((s) => s.day) ?? services.clock.today();
  const [report, setReport] = useState<Report | undefined>();
  const [error, setError] = useState(false);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const seq = ++latest.current;
    try {
      performance.mark('moy-ritm:report-start');
      const next = await services.reports.build(period);
      performance.measure('moy-ritm:report', 'moy-ritm:report-start');
      if (seq !== latest.current) return;
      setReport(next);
      setError(false);
    } catch {
      if (seq === latest.current) setError(true);
    }
  }, [services, period]);

  useEffect(() => {
    void load();
  }, [load, dataVersion, today]);

  return {
    report: report && samePeriod(report.period, period) ? report : undefined,
    error,
    reload: load,
  };
}

const samePeriod = (a: ReportPeriod, b: ReportPeriod) =>
  a.kind === b.kind && (a.kind === 'week' ? a.monday === (b as typeof a).monday : a.month === (b as typeof a).month);

/** Экран «Отчёты» (раздел 9): неделя (по умолчанию) или месяц, навигация по периодам. */
export function ReportsPage() {
  const services = useServices();
  const [period, setPeriod] = useState<ReportPeriod>(() => currentPeriod('week', services.clock.today()));
  const { report, error, reload } = useReport(period);
  const titleId = useId();

  return (
    <div className="reports-page">
      <header className="page-header page-header-row">
        <h1 className="page-title">Отчёты</h1>
        <fieldset className="week-switch">
          <legend className="visually-hidden">Период отчёта</legend>
          <Segmented
            name="report-kind"
            value={period.kind}
            options={[
              ['week', 'Неделя'],
              ['month', 'Месяц'],
            ]}
            onChange={(v) => setPeriod(currentPeriod(v as ReportKind, services.clock.today()))}
          />
        </fieldset>
      </header>

      <nav className="period-bar" aria-label="Выбор периода">
        <button type="button" className="btn btn-secondary btn-small" disabled={!report?.canPrev} onClick={() => setPeriod(shiftPeriod(period, -1))}>
          ← Раньше
        </button>
        <div className="period-title-block">
          <h2 id={titleId} className="period-title" aria-live="polite">
            {periodTitle(period)}
          </h2>
          {report?.asOfToday && <p className="hint">По состоянию на сегодня</p>}
        </div>
        <button type="button" className="btn btn-secondary btn-small" disabled={!report?.canNext} onClick={() => setPeriod(shiftPeriod(period, 1))}>
          Позже →
        </button>
      </nav>

      {error ? (
        <div className="notice notice-danger" role="alert">
          <p>Не удалось построить отчёт.</p>
          <button type="button" className="btn btn-secondary" onClick={() => void reload()}>
            Повторить
          </button>
        </div>
      ) : !report ? (
        <div className="skeleton skeleton-line" aria-label="Загрузка отчёта" />
      ) : (
        <>
          <Summary report={report} />
          {report.period.kind === 'week' ? <WeekBreakdown report={report} /> : <MonthGrid report={report} />}
          <HabitsBlock report={report} />
        </>
      )}
    </div>
  );
}

function Percent({ value }: { value: number | null }) {
  if (value === null)
    return (
      <p className="stat-percent stat-empty">
        <span aria-hidden="true">—</span>
        <span className="stat-empty-text">{NO_PLAN_TEXT}</span>
      </p>
    );
  return <p className="stat-percent">{value}%</p>;
}

/** Сводные цифры по задачам и привычкам (п. 9.4–9.5). */
function Summary({ report }: { report: Report }) {
  const { tasks, habits } = report;
  return (
    <div className="report-summary">
      <section className="stat-card stat-card-dark" aria-labelledby="sum-tasks" data-testid="summary-tasks">
        <h2 id="sum-tasks" className="stat-title">
          Задачи
        </h2>
        <Percent value={tasks.percent} />
        <dl className="stat-list">
          <div>
            <dt>Выполнено</dt>
            <dd>
              {tasks.done} из {tasks.planned}
            </dd>
          </div>
          <div>
            <dt>Пропущено</dt>
            <dd>{tasks.missed}</dd>
          </div>
          <div>
            <dt>Автопереносов</dt>
            <dd>{tasks.autoMoves}</dd>
          </div>
          <div>
            <dt>Выполнено без срока</dt>
            <dd>{tasks.doneUndated}</dd>
          </div>
        </dl>
      </section>
      <section className="stat-card" aria-labelledby="sum-habits" data-testid="summary-habits">
        <h2 id="sum-habits" className="stat-title">
          Привычки
        </h2>
        <Percent value={habits.percent} />
        <dl className="stat-list">
          <div>
            <dt>Выполнено</dt>
            <dd>
              {habits.done} из {habits.planned}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

const ratio = (done: number, planned: number) => `${done} из ${planned}`;

/** Разбивка недели по дням: 7 столбцов + та же информация таблицей для скринридера (п. 9.4). */
function WeekBreakdown({ report }: { report: Report }) {
  const caption = `По дням, ${periodTitle(report.period)}`;
  return (
    <section className="card" aria-labelledby="by-days">
      <h2 id="by-days" className="card-title">
        По дням
      </h2>
      <ol className="day-columns" aria-hidden="true">
        {report.days.map((d, i) => (
          <li key={d.date} className={`day-col day-col-${d.state}`}>
            <span className="day-col-name">{WEEKDAY_SHORT[i]}</span>
            <span className="day-col-date">{Number(d.date.slice(8))}</span>
            {d.state === 'counted' ? (
              <>
                <DayBar label="Задачи" done={d.tasks.done} planned={d.tasks.planned} />
                <DayBar label="Привычки" done={d.habits.done} planned={d.habits.planned} />
              </>
            ) : (
              <span className="day-col-note">{d.state === 'ahead' ? 'Впереди' : '—'}</span>
            )}
          </li>
        ))}
      </ol>
      <p className="hint day-legend" aria-hidden="true">
        <span>
          <span className="legend-mark legend-tasks" /> задачи
        </span>
        <span>
          <span className="legend-mark legend-habits" /> привычки «Каждый день» и «По дням недели»
        </span>
      </p>
      <div className="visually-hidden">
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">День</th>
              <th scope="col">Задачи</th>
              <th scope="col">Привычки</th>
            </tr>
          </thead>
          <tbody>
            {report.days.map((d) => (
              <tr key={d.date}>
                <th scope="row">{formatWeekdayDayMonth(d.date)}</th>
                <td>{d.state === 'counted' ? ratio(d.tasks.done, d.tasks.planned) : d.state === 'ahead' ? 'Впереди' : 'До начала'}</td>
                <td>{d.state === 'counted' ? ratio(d.habits.done, d.habits.planned) : d.state === 'ahead' ? 'Впереди' : 'До начала'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DayBar({ label, done, planned }: { label: string; done: number; planned: number }) {
  const kind = label === 'Задачи' ? 'tasks' : 'habits';
  const height = planned === 0 ? 0 : Math.round((done / planned) * 100);
  return (
    <span className={`day-bar day-bar-${kind}`} title={`${label}: ${ratio(done, planned)}`}>
      <span className="day-bar-track">
        <span className="day-bar-fill" style={{ height: `${height}%` }} />
      </span>
      <span className="day-bar-text">{planned === 0 ? '—' : `${done}/${planned}`}</span>
    </span>
  );
}

const MARK_TEXT: Record<MarkState, string> = {
  done: 'выполнено',
  extra: 'отмечено вне плана, не учитывается',
  missed: 'не выполнено',
  open: 'ещё не отмечено',
  free: 'без отметки',
  off: 'не запланировано',
  inactive: 'привычки не было или она в архиве',
  ahead: 'впереди',
};

/** Привычки: неделя — строка из 7 кругов и итог; месяц — полоса прогресса с подписью (п. 9.4–9.5). */
function HabitsBlock({ report }: { report: Report }) {
  if (report.habitRows.length === 0) return null;
  return (
    <section className="card" aria-labelledby="by-habits">
      <h2 id="by-habits" className="card-title">
        По привычкам
      </h2>
      <ul className="report-habits">
        {report.habitRows.map((row) => (report.period.kind === 'week' ? <WeekHabit key={row.id} row={row} /> : <MonthHabit key={row.id} row={row} />))}
      </ul>
    </section>
  );
}

function HabitName({ row }: { row: HabitRow }) {
  return (
    <span className="report-habit-name">
      {row.title}
      {row.archived && <span className="badge">в архиве</span>}
    </span>
  );
}

function WeekHabit({ row }: { row: HabitRow }) {
  return (
    <li className="report-habit" data-testid="report-habit">
      <div className="report-habit-head">
        <HabitName row={row} />
        <span className="report-habit-total">{row.text}</span>
      </div>
      <ul className="mark-row" aria-label={`Отметки «${row.title}» по дням`}>
        {row.marks.map((m, i) => (
          <li key={m.date} className="mark-day">
            <span className="mark-day-label" aria-hidden="true">
              {WEEKDAY_SHORT[i]}
            </span>
            <span className={`mark mark-${m.state}`} title={MARK_TEXT[m.state]}>
              {(m.state === 'done' || m.state === 'extra') && (
                <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
              <span className="visually-hidden">
                {formatWeekdayDayMonth(m.date)}: {MARK_TEXT[m.state]}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}

function MonthHabit({ row }: { row: HabitRow }) {
  const width = row.percent ?? 0;
  return (
    <li className="report-habit" data-testid="report-habit">
      <div className="report-habit-head">
        <HabitName row={row} />
        <span className="report-habit-total">
          {row.text}
          {row.percent !== null && <span className="report-habit-percent">{row.percent}%</span>}
        </span>
      </div>
      <span className="progress" aria-hidden="true">
        <span className="progress-fill" style={{ width: `${width}%` }} />
      </span>
      {row.running && <p className="hint">Текущая неделя: {row.running}</p>}
    </li>
  );
}

const LEGEND: Array<keyof typeof LEVEL_TEXT> = ['none', '0-24', '25-49', '50-74', '75-100', 'ahead'];

function cellClass(day: ReportDay): string {
  if (day.state === 'ahead') return 'cell cell-ahead';
  if (day.state === 'before') return 'cell cell-before';
  return day.level ? `cell cell-l${LEGEND.indexOf(day.level)}` : 'cell cell-none';
}

/** Календарная сетка активности месяца (п. 9.5): уровень — насыщенностью, точное значение — в подсказке и aria-label. */
function MonthGrid({ report }: { report: Report }) {
  const [selected, setSelected] = useState<string | undefined>();
  const detailId = useId();
  const lead = (new Date(`${report.start}T12:00:00`).getDay() + 6) % 7; // пустые ячейки до 1-го числа
  const selectedDay = report.days.find((d) => d.date === selected);
  return (
    <section className="card" aria-labelledby="activity">
      <h2 id="activity" className="card-title">
        Активность по дням
      </h2>
      <div className="calendar" role="group" aria-label={`Активность, ${periodTitle(report.period)}`}>
        {WEEKDAY_SHORT.map((w) => (
          <span key={w} className="calendar-head" aria-hidden="true">
            {w}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead-${i}`} aria-hidden="true" />
        ))}
        {report.days.map((d) => (
          <button
            key={d.date}
            type="button"
            className={cellClass(d)}
            aria-label={cellLabel(d)}
            aria-describedby={selected === d.date ? detailId : undefined}
            aria-pressed={selected === d.date}
            title={cellLabel(d)}
            data-date={d.date}
            onClick={() => setSelected(selected === d.date ? undefined : d.date)}
          >
            {Number(d.date.slice(8))}
          </button>
        ))}
      </div>
      <p id={detailId} className={selectedDay ? 'cell-detail' : 'cell-detail hint'} aria-live="polite">
        {selectedDay ? detailText(selectedDay) : 'Нажмите на день, чтобы увидеть точное значение.'}
      </p>
      <ul className="legend" aria-label="Уровни">
        {LEGEND.map((key) => (
          <li key={key} className="legend-item">
            <span
              className={`cell-swatch ${key === 'none' ? 'cell-none' : key === 'ahead' ? 'cell-ahead' : `cell-l${LEGEND.indexOf(key)}`}`}
              aria-hidden="true"
            />
            {LEVEL_TEXT[key]}
          </li>
        ))}
      </ul>
      <p className="hint">Учитываются задачи и привычки «Каждый день» и «По дням недели»; «Цель на неделю» — в прогрессе привычек ниже.</p>
    </section>
  );
}

function detailText(day: ReportDay): string {
  if (day.state !== 'counted' || day.percent === null) return cellLabel(day);
  const parts = [`задачи ${ratio(day.tasks.done, day.tasks.planned)}`, `привычки ${ratio(day.habits.done, day.habits.planned)}`];
  return `${cellLabel(day)} (${parts.join(', ')})`;
}
