import type { ReactNode } from 'react';
import { Dialog } from './Dialog';

type Props = {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Подтверждение массового или необратимого действия (п. 12.4). */
export function ConfirmDialog({ open, title, children, confirmLabel, cancelLabel = 'Отмена', danger, onConfirm, onCancel }: Props) {
  return (
    <Dialog open={open} title={title} onClose={onCancel}>
      <div>{children}</div>
      <div className="button-row">
        <button type="button" className={danger ? 'btn btn-danger-solid' : 'btn btn-primary'} onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </Dialog>
  );
}
