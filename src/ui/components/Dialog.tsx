import { useEffect, useId, useRef, type ReactNode } from 'react';

type Props = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Запрет закрытия по Esc, пока идёт операция. */
  locked?: boolean;
};

/**
 * Модальный диалог на основе <dialog>: удерживает фокус, закрывается по Esc,
 * возвращает фокус на элемент, который его открыл (п. 12.2).
 */
export function Dialog({ open, title, onClose, children, locked = false }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
      if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!locked) onClose();
      }}
    >
      {open && (
        <div className="dialog-body">
          <h2 id={titleId} className="dialog-title">
            {title}
          </h2>
          {children}
        </div>
      )}
    </dialog>
  );
}
