import { CATEGORY_COLOR_LABEL, CATEGORY_COLORS } from '../../domain/categories';
import type { Category, CategoryColor } from '../../domain/types';

/** Цветная точка и название — цвет никогда не единственный признак (п. 12.2). */
export function CategoryLabel({ category }: { category: Pick<Category, 'name' | 'color'> }) {
  return (
    <span className="cat-label">
      <span className={`cat-dot cat-${category.color}`} aria-hidden="true" />
      {category.name}
    </span>
  );
}

/** Выбор цвета из палитры: радиокнопки с подписью для скринридера и галочкой у выбранного. */
export function ColorPicker({
  value,
  onChange,
  name,
}: {
  value: CategoryColor;
  onChange: (c: CategoryColor) => void;
  name: string;
}) {
  return (
    <fieldset className="color-picker">
      <legend>Цвет</legend>
      <div className="swatches">
        {CATEGORY_COLORS.map((color) => (
          <label key={color} className={`swatch cat-${color}`} title={CATEGORY_COLOR_LABEL[color]}>
            <input
              type="radio"
              name={name}
              value={color}
              checked={value === color}
              onChange={() => onChange(color)}
              className="swatch-input"
            />
            <span className="visually-hidden">{CATEGORY_COLOR_LABEL[color]}</span>
            <svg className="swatch-check" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 12.5l4 4L18 8" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
