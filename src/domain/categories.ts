import { normalize } from './normalize';
import { CATEGORY_COLORS, type Category, type CategoryColor } from './types';

export const CATEGORY_NAME_MAX = 30;

/** Подписи цветов палитры категорий (п. 6.4) — цвет никогда не единственный признак. */
export const CATEGORY_COLOR_LABEL: Record<CategoryColor, string> = {
  clay: 'Терракотовый',
  amber: 'Янтарный',
  olive: 'Оливковый',
  green: 'Зелёный',
  teal: 'Бирюзовый',
  blue: 'Синий',
  violet: 'Фиолетовый',
  rose: 'Малиновый',
};

export { CATEGORY_COLORS };

/**
 * Название категории: 1–30 символов, уникально среди неудалённых категорий после нормализации
 * (NFC, пробелы по краям, регистр ru-RU, ё → е), п. 6.4, 13.4.
 */
export function validateCategoryName(
  raw: string,
  existing: Pick<Category, 'id' | 'normalizedName' | 'deletedAt'>[],
  selfId: string | null = null,
): { ok: true; name: string; normalizedName: string } | { ok: false; error: string } {
  const name = raw.normalize('NFC').trim();
  const len = [...name].length;
  if (len === 0) return { ok: false, error: 'Введите название категории' };
  if (len > CATEGORY_NAME_MAX) return { ok: false, error: `Название — не длиннее ${CATEGORY_NAME_MAX} символов` };
  const normalizedName = normalize(name);
  const taken = existing.some((c) => c.deletedAt === null && c.id !== selfId && c.normalizedName === normalizedName);
  if (taken) return { ok: false, error: 'Категория с таким названием уже есть' };
  return { ok: true, name, normalizedName };
}

export function sortCategories<T extends Pick<Category, 'normalizedName'>>(list: T[]): T[] {
  return [...list].sort((a, b) => a.normalizedName.localeCompare(b.normalizedName, 'ru'));
}
