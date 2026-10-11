import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { addDaysIso, dayLabel, localDateOf } from '../../domain/dates';
import { normalize } from '../../domain/normalize';
import { SEARCH_COMPLETED_DAYS, searchTasks, type SearchResult } from '../../domain/tasks';
import type { Category, Task } from '../../domain/types';
import { useAppStore } from '../state';
import { TaskGroup, type RowHandlers } from './TaskGroup';

/** Задержка ввода поиска (п. 7.4). */
export const SEARCH_DELAY_MS = 150;

/**
 * Поиск по всем задачам (п. 7.4): строка ввода с задержкой 150 мс, Esc и кнопка очистки.
 * Возвращает поле и результат; пока запрос пуст, результат — null и экран показывает обычный список.
 */
export function useTaskSearch(tasks: Task[], today: string) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const announce = useAppStore((s) => s.announce);

  useEffect(() => {
    if (!query.trim()) {
      setDebounced('');
      return;
    }
    const timer = setTimeout(() => {
      performance.mark('moy-ritm:search-start'); // конец задержки ввода — начало замера п. 15.2
      setDebounced(query);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // Нормализованные названия считаются один раз при загрузке задач, а не на каждый запрос (п. 15.2: ≤ 100 мс).
  const normalized = useMemo(() => {
    const cache = new Map<string, string>();
    for (const t of tasks) if (!cache.has(t.title)) cache.set(t.title, normalize(t.title));
    return (value: string) => cache.get(value) ?? normalize(value);
  }, [tasks]);

  const result = useMemo<SearchResult | null>(() => {
    if (!debounced.trim()) return null;
    return searchTasks(tasks, debounced, today, localDateOf, normalized, addDaysIso(today, -SEARCH_COMPLETED_DAYS));
  }, [tasks, debounced, today, normalized]);

  // Число найденных — через aria-live (п. 7.4). Объявляем только при смене запроса, не при каждом действии с задачей.
  const total = result?.total;
  useEffect(() => {
    if (!debounced.trim() || total === undefined) return;
    announce(total === 0 ? `Ничего не нашлось по запросу «${debounced.trim()}»` : `Найдено задач: ${total}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  return { query, setQuery, result: query.trim() ? result : null, searching: query.trim() !== '' };
}

export function SearchField({ query, onChange }: { query: string; onChange: (value: string) => void }) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="search" role="search">
      <label htmlFor={id} className="visually-hidden">
        Поиск задач
      </label>
      <svg className="search-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2.2" />
        <path d="M16.5 16.5L21 21" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
      <input
        ref={inputRef}
        id={id}
        type="text"
        inputMode="search"
        enterKeyHint="search"
        className="input search-input"
        placeholder="Поиск задач"
        value={query}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && query) {
            e.preventDefault();
            e.stopPropagation();
            onChange('');
          }
        }}
      />
      {query && (
        <button
          type="button"
          className="icon-btn search-clear"
          aria-label="Очистить поиск"
          onClick={() => {
            onChange('');
            inputRef.current?.focus();
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}

type ResultsProps = {
  result: SearchResult | null;
  categoryById: Map<string, Category>;
  rowProps: RowHandlers;
  readOnly: (task: Task) => boolean;
};

/** Сколько строк результата рисуется сразу; остальные — порциями в следующих кадрах (п. 15.2: показ ≤ 100 мс). */
const FIRST_ROWS = 12;
const NEXT_ROWS = 200;

/** Результаты заменяют список экрана и группируются: «Сегодня», «Предстоящие», «Без даты», «Выполненные» (п. 7.4). */
export function SearchResults({ result, categoryById, rowProps, readOnly }: ResultsProps) {
  const [limit, setLimit] = useState(FIRST_ROWS);
  // Новый запрос — снова первая порция.
  useEffect(() => setLimit(FIRST_ROWS), [result?.query]);
  const total = result?.total ?? 0;
  // Замер п. 15.2: от конца задержки ввода до кадра с результатами — performance.measure('moy-ritm:search').
  useEffect(() => {
    if (!result) return;
    const frame = requestAnimationFrame(() => {
      try {
        performance.measure('moy-ritm:search', 'moy-ritm:search-start');
        performance.clearMarks('moy-ritm:search-start');
      } catch {
        // результат обновился без нового запроса (например, изменили задачу) — не замер поиска
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [result]);
  useEffect(() => {
    if (limit >= total) return;
    const frame = requestAnimationFrame(() => setLimit((l) => l + NEXT_ROWS));
    return () => cancelAnimationFrame(frame);
  }, [limit, total]);

  if (!result) {
    return <div className="skeleton skeleton-line" aria-hidden="true" />;
  }
  if (result.total === 0) {
    return (
      <section className="empty" aria-label="Результаты поиска">
        <p className="empty-text">Ничего не нашлось по запросу «{result.query}»</p>
      </section>
    );
  }
  const today = rowProps.today;
  const label = (t: Task) => (t.plannedDate ? dayLabel(t.plannedDate, today) : 'Без даты');
  const common = { categoryById, rowProps, dateLabel: label, readOnly };
  let budget = limit;
  const take = (list: Task[]) => {
    const part = list.slice(0, Math.max(0, budget));
    budget -= part.length;
    return part;
  };
  const groups: Array<[string, Task[]]> = [
    ['Сегодня', result.today],
    ['Предстоящие', result.upcoming],
    ['Без даты', result.undated],
    ['Выполненные', result.completed],
  ];
  return (
    <div className="search-results" data-testid="search-results">
      {groups.map(([title, list]) => (
        <TaskGroup key={title} title={title} tasks={take(list)} total={list.length} repeatText={title !== 'Выполненные'} {...common} />
      ))}
    </div>
  );
}
