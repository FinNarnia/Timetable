import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

/** Локальная календарная дата в формате YYYY-MM-DD. */
export function toIsoDate(date: Date): string {
  return isoOf(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

/** YYYY-MM-DD из чисел; без date-fns — функция вызывается десятки тысяч раз при расчёте отчёта (п. 15.2). */
function isoOf(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** «Пятница, 09.10.2026» — заголовок экрана «Сегодня» (п. 1.4, 7.1). */
export function formatLongDate(date: Date): string {
  const weekday = format(date, 'EEEE', { locale: ru });
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${format(date, 'dd.MM.yyyy')}`;
}

/** ДД.ММ.ГГГГ ЧЧ:ММ — для дат в настройках (дата копии и т. п.). */
export function formatDateTime(date: Date): string {
  return format(date, 'dd.MM.yyyy HH:mm');
}

/** Приветствие по времени суток. */
export function greetingFor(date: Date): string {
  const h = date.getHours();
  if (h < 5) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}

/** Локальная календарная дата момента ISO 8601 (например, completedAt). */
export function localDateOf(iso: string): string {
  return toIsoDate(new Date(iso));
}

/** Время дня ЧЧ:ММ по локальным часам. */
export function toTimeOfDay(date: Date): string {
  return format(date, 'HH:mm');
}

/** Дата через n дней (по календарю, без учёта переходов на летнее время). */
export function addDaysIso(isoDate: string, days: number): string {
  const y = Number(isoDate.slice(0, 4));
  const m = Number(isoDate.slice(5, 7));
  const d = Number(isoDate.slice(8, 10));
  // Календарная арифметика в UTC: переходы на летнее время не влияют.
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return isoOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** ДД.ММ.ГГГГ из YYYY-MM-DD. */
export function formatIsoDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}.${m}.${y}`;
}

const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** «пн, 12 окт» из YYYY-MM-DD (п. 7.3); год добавляется, если он не совпадает с текущим. */
export function formatShortDay(isoDate: string, today: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const weekday = WEEKDAYS_SHORT[new Date(y, m - 1, d).getDay()];
  const year = today.slice(0, 4) === String(y) ? '' : ` ${y}`;
  return `${weekday}, ${d} ${MONTHS_SHORT[m - 1]}${year}`;
}

/** Подпись дня: «Сегодня», «Завтра» или «пн, 12 окт». */
export function dayLabel(isoDate: string, today: string): string {
  if (isoDate === today) return 'Сегодня';
  if (isoDate === addDaysIso(today, 1)) return 'Завтра';
  return formatShortDay(isoDate, today);
}

const MONTHS_GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS_FULL = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

/** «Вторник, 14 октября» — подпись круга отметки (п. 8.3). */
export function formatWeekdayDayMonth(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return `${WEEKDAYS_FULL[new Date(y, m - 1, d).getDay()]}, ${d} ${MONTHS_GENITIVE[m - 1]}`;
}

/** «12–18 октября», «28 сентября — 4 октября» — заголовок недели. */
export function formatWeekRange(monday: string): string {
  const sunday = addDaysIso(monday, 6);
  const [, m1, d1] = monday.split('-').map(Number) as [number, number, number];
  const [, m2, d2] = sunday.split('-').map(Number) as [number, number, number];
  if (m1 === m2) return `${d1}–${d2} ${MONTHS_GENITIVE[m2 - 1]}`;
  return `${d1} ${MONTHS_GENITIVE[m1 - 1]} — ${d2} ${MONTHS_GENITIVE[m2 - 1]}`;
}

/** Начало локального дня YYYY-MM-DD как момент ISO 8601 UTC (границы выборки по completedAt). */
export function localDayStartIso(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toISOString();
}
