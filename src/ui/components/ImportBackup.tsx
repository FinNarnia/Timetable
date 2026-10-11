import { useRef, useState } from 'react';
import { ParseCancelledError } from '../../application/backup/BackupParser';
import { BACKUP_ERROR_TEXT, type BackupSummary } from '../../application/backup/parseBackup';
import { formatDateTime } from '../../domain/dates';
import type { DataSet, Profile } from '../../domain/types';
import { StorageError } from '../../application/public';
import { useAppStore, useServices } from '../state';
import { Dialog } from './Dialog';
import { runMaintenance } from '../maintenance';

type Phase =
  | { kind: 'idle' }
  | { kind: 'checking'; controller: AbortController }
  | { kind: 'summary'; data: DataSet; summary: BackupSummary }
  | { kind: 'error'; text: string };

type Props = {
  buttonLabel: string;
  buttonClassName?: string;
  /** Текущие данные будут заменены — предупреждение показывается, только если они есть. */
  replacesExisting: boolean;
  onImported: (profile: Profile) => void;
};

/** Восстановление из резервной копии: выбор файла → проверка → сводка → запись (п. 4.4). */
export function ImportBackup({ buttonLabel, buttonClassName = 'btn btn-secondary', replacesExisting, onImported }: Props) {
  const services = useServices();
  const dataService = services.data;
  const setBlocker = useAppStore((s) => s.setBlocker);
  const setWriteError = useAppStore((s) => s.setWriteError);
  const toast = useAppStore((s) => s.toast);
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  async function onFile(file: File | undefined) {
    if (inputRef.current) inputRef.current.value = '';
    if (!file) return;
    const controller = new AbortController();
    setPhase({ kind: 'checking', controller });
    try {
      const result = await dataService.checkBackup(file, controller.signal);
      if (result.ok) setPhase({ kind: 'summary', data: result.data, summary: result.summary });
      else setPhase({ kind: 'error', text: BACKUP_ERROR_TEXT[result.error] });
    } catch (error) {
      if (error instanceof ParseCancelledError) setPhase({ kind: 'idle' });
      else setPhase({ kind: 'error', text: BACKUP_ERROR_TEXT['not-a-backup'] });
    }
  }

  async function confirm(data: DataSet) {
    setPhase({ kind: 'idle' });
    setBlocker('Восстанавливаем данные…');
    try {
      const profile = await dataService.importBackup(data);
      // Восстановленные данные могли «отстать» на несколько дней — обслуживание дня сразу (п. 10.2).
      await runMaintenance(services);
      useAppStore.getState().bumpData();
      setBlocker(undefined);
      onImported(profile);
      toast('Данные восстановлены из резервной копии');
    } catch (error) {
      setBlocker(undefined);
      if (error instanceof StorageError && error.kind === 'quota') setWriteError('quota');
      setPhase({ kind: 'error', text: 'Не удалось восстановить данные. Прежние данные сохранены.' });
    }
  }

  const close = () => setPhase({ kind: 'idle' });

  return (
    <>
      <button type="button" className={buttonClassName} onClick={() => inputRef.current?.click()}>
        {buttonLabel}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="backup-file-input"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />

      <Dialog open={phase.kind === 'checking'} title="Проверяем файл…" onClose={() => {}} locked>
        <div className="button-row" style={{ alignItems: 'center' }}>
          <div className="spinner" aria-hidden="true" />
          <p role="status">Проверяем резервную копию. Данные пока не меняются.</p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => phase.kind === 'checking' && phase.controller.abort()}
        >
          Отменить
        </button>
      </Dialog>

      <Dialog open={phase.kind === 'summary'} title="Восстановить из копии?" onClose={close}>
        {phase.kind === 'summary' && (
          <>
            <dl className="def-list">
              <dt>Дата копии</dt>
              <dd>{formatDateTime(new Date(phase.summary.exportedAt))}</dd>
              <dt>Профиль</dt>
              <dd>{phase.summary.profileName}</dd>
              <dt>Задач</dt>
              <dd>{phase.summary.tasks}</dd>
              <dt>Привычек</dt>
              <dd>{phase.summary.habits}</dd>
              <dt>Отметок</dt>
              <dd>{phase.summary.habitChecks}</dd>
            </dl>
            {replacesExisting && (
              <div className="notice notice-warning" role="note">
                <p className="notice-title">Текущие данные будут заменены</p>
                <p>Всё, что сейчас есть в приложении, заменится данными из этой копии.</p>
              </div>
            )}
            <div className="button-row">
              <button type="button" className="btn btn-primary" onClick={() => void confirm(phase.data)}>
                Восстановить
              </button>
              <button type="button" className="btn btn-secondary" onClick={close}>
                Отмена
              </button>
            </div>
          </>
        )}
      </Dialog>

      <Dialog open={phase.kind === 'error'} title="Не получилось" onClose={close}>
        {phase.kind === 'error' && (
          <>
            <p role="alert">{phase.text}</p>
            <button type="button" className="btn btn-secondary" onClick={close}>
              Понятно
            </button>
          </>
        )}
      </Dialog>
    </>
  );
}
