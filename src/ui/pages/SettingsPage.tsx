import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ValidationError } from '../../application/services';
import { formatDateTime } from '../../domain/dates';
import type { UserSettings } from '../../domain/types';
import type { NotificationPermissionStatus, PersistenceStatus } from '../../application/public';
import { REMINDER_TIMES } from '../../domain/reminder';
import { StorageError } from '../../application/public';
import { Dialog } from '../components/Dialog';
import { ImportBackup } from '../components/ImportBackup';
import { CategoriesBlock } from './CategoriesBlock';
import { PERSISTENCE_STATUS_TEXT, PersistenceWarning } from '../components/PersistenceNotice';
import { downloadFile, useAppStore, useServices } from '../state';

/** Настройки (п. 10.4): профиль, категории, уведомления, данные, о приложении. */
export function SettingsPage() {
  return (
    <>
      <header className="page-header">
        <h1 className="page-title">Настройки</h1>
      </header>
      <div className="settings-grid">
        <ProfileBlock />
        <CategoriesBlock />
        <NotificationsBlock />
        <DataBlock />
        <AboutBlock />
      </div>
    </>
  );
}

function ProfileBlock() {
  const services = useServices();
  const profile = useAppStore((s) => s.profile);
  const setReady = useAppStore((s) => s.setReady);
  const toast = useAppStore((s) => s.toast);
  const [name, setName] = useState(profile?.name ?? '');
  const [error, setError] = useState<string | undefined>();
  const inputId = useId();
  const errorId = useId();

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      const next = await services.profile.rename(name);
      setReady(next);
      setName(next.name);
      toast('Имя сохранено');
    } catch (e) {
      setError(e instanceof ValidationError ? e.message : 'Не удалось сохранить имя. Попробуйте ещё раз.');
    }
  }

  return (
    <section className="card" aria-labelledby="profile-title">
      <h2 id="profile-title" className="card-title">
        Профиль
      </h2>
      <form className="field" onSubmit={(e) => void save(e)} noValidate>
        <label htmlFor={inputId}>Имя</label>
        <input
          id={inputId}
          className="input"
          value={name}
          maxLength={60}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => {
            setName(e.target.value);
            setError(undefined);
          }}
        />
        {error && (
          <p id={errorId} className="field-error">
            {error}
          </p>
        )}
        <div className="button-row">
          <button type="submit" className="btn btn-secondary" disabled={name.trim() === profile?.name}>
            Сохранить имя
          </button>
        </div>
      </form>
    </section>
  );
}

const PERMISSION_TEXT: Record<NotificationPermissionStatus, string> = {
  granted: 'Разрешены',
  default: 'Не запрошены',
  denied: 'Заблокированы в настройках браузера',
  unsupported: 'Этот браузер не показывает системные уведомления',
};

/** Уведомления (п. 10.1, 10.4): переключатель, время, разрешение браузера — только по кнопке. */
function NotificationsBlock() {
  const services = useServices();
  const toast = useAppStore((s) => s.toast);
  const dataVersion = useAppStore((s) => s.dataVersion);
  const [settings, setSettings] = useState<UserSettings | undefined>();
  const [permission, setPermission] = useState<NotificationPermissionStatus>(() => services.reminder.permission());
  const switchId = useId();
  const timeId = useId();
  const noteId = useId();

  useEffect(() => {
    void services.reminder.current().then(setSettings).catch(() => undefined);
  }, [services, dataVersion]);

  /** Оптимистично: переключатель меняется сразу, при ошибке записи — откат и сообщение (п. 15.5). */
  async function update(change: Partial<UserSettings>, op: () => Promise<UserSettings>) {
    const before = settings;
    setSettings((s) => (s ? { ...s, ...change } : s));
    try {
      setSettings(await op());
    } catch {
      setSettings(before);
      toast('Не удалось сохранить настройку. Попробуйте ещё раз.');
    }
  }

  if (!settings) return null;
  const enabled = settings.eveningReminderEnabled;
  return (
    <section className="card" aria-labelledby="notify-title">
      <h2 id="notify-title" className="card-title">
        Уведомления
      </h2>
      <div className="switch-row">
        <input
          id={switchId}
          type="checkbox"
          role="switch"
          className="switch"
          checked={enabled}
          aria-describedby={noteId}
          onChange={(e) => {
            const on = e.target.checked;
            void update({ eveningReminderEnabled: on }, () => services.reminder.setEnabled(on));
          }}
        />
        <label htmlFor={switchId}>Вечернее напоминание о задачах на завтра</label>
      </div>
      <p id={noteId} className="hint">
        Напоминание приходит, только если приложение открыто в браузере. Если оно закрыто, доставка не гарантируется.
      </p>
      <div className="field">
        <label htmlFor={timeId}>Время</label>
        <select
          id={timeId}
          className="input input-time"
          value={settings.eveningReminderTime}
          disabled={!enabled}
          onChange={(e) => {
            const time = e.target.value;
            void update({ eveningReminderTime: time }, () => services.reminder.setTime(time));
          }}
        >
          {REMINDER_TIMES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <dl className="def-list">
        <dt>Уведомления браузера</dt>
        <dd data-testid="notification-permission">{PERMISSION_TEXT[permission]}</dd>
      </dl>
      {permission === 'default' && (
        <div className="button-row">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void services.reminder.requestPermission().then(setPermission)}
          >
            Разрешить уведомления браузера
          </button>
        </div>
      )}
      {permission === 'denied' && <p className="hint">Разрешить их снова можно в настройках сайта в браузере. Внутреннее напоминание в приложении работает и так.</p>}
    </section>
  );
}

function DataBlock() {
  const services = useServices();
  const navigate = useNavigate();
  const setReady = useAppStore((s) => s.setReady);
  const setFirstRun = useAppStore((s) => s.setFirstRun);
  const setWriteError = useAppStore((s) => s.setWriteError);
  const setBlocker = useAppStore((s) => s.setBlocker);
  const toast = useAppStore((s) => s.toast);
  const [persistence, setPersistence] = useState<PersistenceStatus | undefined>();
  const [settings, setSettings] = useState<UserSettings | undefined>();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const reload = useCallback(async () => {
    setSettings(await services.data.currentSettings());
  }, [services]);

  useEffect(() => {
    // Пока устойчивое хранилище не выдано, запрос повторяется при каждом открытии настроек (п. 4.5).
    // Сначала текущий статус, затем запрос: в Firefox ответ ждёт решения пользователя (п. 4.5).
    void services.data.persistenceStatus().then((status) => setPersistence((prev) => prev ?? status));
    void services.data.requestPersistence().then(setPersistence);
    void reload();
  }, [services, reload]);

  async function exportBackup() {
    try {
      const file = await services.data.exportBackup();
      downloadFile(file.fileName, file.content);
      await services.data.markExported();
      await reload();
      toast('Резервная копия скачана');
    } catch (e) {
      if (e instanceof StorageError) setWriteError(e.kind);
      else toast('Не удалось подготовить копию. Попробуйте ещё раз.');
    }
  }

  async function deleteAll() {
    setDeleteOpen(false);
    setBlocker('Удаляем данные…');
    try {
      await services.data.deleteAllData();
      setBlocker(undefined);
      setFirstRun();
      navigate('/');
    } catch {
      setBlocker(undefined);
      toast('Не удалось удалить данные. Попробуйте ещё раз.');
    }
  }

  return (
    <section className="card" aria-labelledby="data-title">
      <h2 id="data-title" className="card-title">
        Данные
      </h2>
      <p>
        Все данные хранятся только в этом браузере и никуда не отправляются. Они не зашифрованы: любой, кто пользуется
        этим браузером, может их открыть. Если очистить данные сайта, они пропадут.
      </p>
      <dl className="def-list">
        <dt>Хранилище</dt>
        <dd data-testid="persistence-status">{persistence ? PERSISTENCE_STATUS_TEXT[persistence] : '…'}</dd>
        <dt>Последняя копия</dt>
        <dd data-testid="last-export">
          {settings?.lastExportAt ? formatDateTime(new Date(settings.lastExportAt)) : 'ещё не сохранялась'}
        </dd>
      </dl>
      <PersistenceWarning status={persistence} />
      <div className="button-row">
        <button type="button" className="btn btn-dark" onClick={() => void exportBackup()}>
          Скачать резервную копию
        </button>
        <ImportBackup
          buttonLabel="Восстановить из копии"
          replacesExisting
          onImported={(profile) => {
            setReady(profile);
            navigate('/');
          }}
        />
      </div>
      <div className="button-row">
        <button type="button" className="btn btn-danger" onClick={() => setDeleteOpen(true)}>
          Удалить все данные
        </button>
      </div>
      <DeleteAllDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onExport={() => void exportBackup()}
        onConfirm={() => void deleteAll()}
      />
    </section>
  );
}

/** Удаление всех данных: предложение сохранить копию и ввод слова «УДАЛИТЬ» (п. 4.6). */
function DeleteAllDialog({
  open,
  onClose,
  onExport,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onExport: () => void;
  onConfirm: () => void;
}) {
  const [word, setWord] = useState('');
  const inputId = useId();
  const hintId = useId();
  useEffect(() => {
    if (!open) setWord('');
  }, [open]);
  const matches = word.trim() === 'УДАЛИТЬ';
  return (
    <Dialog open={open} title="Удалить все данные?" onClose={onClose}>
      <p>
        Задачи, привычки, отметки и настройки будут удалены из этого браузера без возможности восстановления. Перед
        удалением сохраните резервную копию.
      </p>
      <button type="button" className="btn btn-secondary" onClick={onExport}>
        Скачать резервную копию
      </button>
      <div className="field">
        <label htmlFor={inputId}>Введите слово УДАЛИТЬ</label>
        <input
          id={inputId}
          className="input"
          value={word}
          autoComplete="off"
          aria-describedby={hintId}
          onChange={(e) => setWord(e.target.value)}
        />
        <p id={hintId} className="hint">
          Так мы убедимся, что удаление не случайное.
        </p>
      </div>
      <div className="button-row">
        <button type="button" className="btn btn-danger-solid" disabled={!matches} onClick={onConfirm}>
          Удалить всё
        </button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Отмена
        </button>
      </div>
    </Dialog>
  );
}

function AboutBlock() {
  const { appVersion, schemaVersion } = useServices();
  return (
    <section className="card" aria-labelledby="about-title">
      <h2 id="about-title" className="card-title">
        О приложении
      </h2>
      <dl className="def-list">
        <dt>Версия приложения</dt>
        <dd>{appVersion}</dd>
        <dt>Версия схемы данных</dt>
        <dd>{schemaVersion}</dd>
      </dl>
    </section>
  );
}
