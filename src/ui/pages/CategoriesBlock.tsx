import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { CategoryValidationError, type CategoryWithCount } from '../../application/public';
import { CATEGORY_COLORS } from '../../domain/categories';
import type { CategoryColor } from '../../domain/types';
import { CategoryLabel, ColorPicker } from '../components/CategoryParts';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Dialog } from '../components/Dialog';
import { useAppStore, useServices } from '../state';

type Editing = { open: false } | { open: true; category?: CategoryWithCount };

function tasksWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'задача';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'задачи';
  return 'задач';
}

/** Блок «Категории» в настройках: создать, переименовать, сменить цвет, удалить (п. 6.4, 10.4). */
export function CategoriesBlock() {
  const { categories: service } = useServices();
  const toast = useAppStore((s) => s.toast);
  const [list, setList] = useState<CategoryWithCount[]>([]);
  const [editing, setEditing] = useState<Editing>({ open: false });
  const [deleting, setDeleting] = useState<CategoryWithCount | undefined>();

  const reload = useCallback(async () => setList(await service.listWithCounts()), [service]);
  useEffect(() => {
    void reload();
  }, [reload]);

  async function confirmDelete() {
    if (!deleting) return;
    const name = deleting.name;
    setDeleting(undefined);
    try {
      await service.delete(deleting.id);
      toast(`Категория «${name}» удалена`);
    } catch {
      toast('Не удалось удалить категорию. Попробуйте ещё раз.');
    }
    await reload();
  }

  return (
    <section className="card" aria-labelledby="categories-title">
      <h2 id="categories-title" className="card-title">
        Категории
      </h2>
      {list.length === 0 ? (
        <p className="hint">Категорий пока нет. Их можно создать здесь или прямо в форме задачи.</p>
      ) : (
        <ul className="category-list">
          {list.map((c) => (
            <li key={c.id} className="category-item">
              <div className="category-info">
                <CategoryLabel category={c} />
                <span className="hint">
                  {c.taskCount} {tasksWord(c.taskCount)}
                </span>
              </div>
              <div className="button-row">
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  aria-label={`Изменить категорию «${c.name}»`}
                  onClick={() => setEditing({ open: true, category: c })}
                >
                  Изменить
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-small"
                  aria-label={`Удалить категорию «${c.name}»`}
                  onClick={() => setDeleting(c)}
                >
                  Удалить
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="button-row">
        <button type="button" className="btn btn-secondary" onClick={() => setEditing({ open: true })}>
          Новая категория
        </button>
      </div>

      {editing.open && (
        <CategoryDialog
          category={editing.category}
          onClose={() => setEditing({ open: false })}
          onSaved={async (text) => {
            setEditing({ open: false });
            toast(text);
            await reload();
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== undefined}
        title="Удалить категорию?"
        confirmLabel="Удалить категорию"
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(undefined)}
      >
        {deleting && (
          <p>
            Категория «{deleting.name}» будет удалена.{' '}
            {deleting.taskCount > 0
              ? `${deleting.taskCount} ${tasksWord(deleting.taskCount)} ${tasksWord(deleting.taskCount) === 'задача' ? 'останется' : 'останутся'}, но без категории.`
              : 'Задач в ней нет.'}
          </p>
        )}
      </ConfirmDialog>
    </section>
  );
}

function CategoryDialog({
  category,
  onClose,
  onSaved,
}: {
  category?: CategoryWithCount;
  onClose: () => void;
  onSaved: (text: string) => Promise<void>;
}) {
  const { categories: service } = useServices();
  const [name, setName] = useState(category?.name ?? '');
  const [color, setColor] = useState<CategoryColor>(category?.color ?? CATEGORY_COLORS[0]);
  const [error, setError] = useState<string | undefined>();
  const inputId = useId();

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      if (category) {
        if (name.trim() !== category.name) await service.rename(category.id, name);
        if (color !== category.color) await service.recolor(category.id, color);
        await onSaved('Категория сохранена');
      } else {
        await service.create(name, color);
        await onSaved('Категория создана');
      }
    } catch (e) {
      setError(e instanceof CategoryValidationError ? e.message : 'Не удалось сохранить категорию.');
      document.getElementById(inputId)?.focus();
    }
  }

  return (
    <Dialog open title={category ? 'Изменить категорию' : 'Новая категория'} onClose={onClose}>
      <form className="task-form" onSubmit={(e) => void save(e)} noValidate>
        <div className="field">
          <label htmlFor={inputId}>Название</label>
          <input
            id={inputId}
            className="input"
            value={name}
            maxLength={30}
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${inputId}-error` : undefined}
            onChange={(e) => {
              setName(e.target.value);
              setError(undefined);
            }}
          />
          {error && (
            <p id={`${inputId}-error`} className="field-error">
              {error}
            </p>
          )}
        </div>
        <ColorPicker name={`${inputId}-color`} value={color} onChange={setColor} />
        <div className="button-row">
          <button type="submit" className="btn btn-primary">
            Сохранить
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Отмена
          </button>
        </div>
      </form>
    </Dialog>
  );
}
