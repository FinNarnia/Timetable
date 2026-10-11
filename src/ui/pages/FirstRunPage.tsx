import { useEffect, useId, useState, type FormEvent } from 'react';
import { ValidationError } from '../../application/services';
import type { PersistenceStatus } from '../../application/public';
import { StorageError } from '../../application/public';
import { ImportBackup } from '../components/ImportBackup';
import { PersistenceWarning } from '../components/PersistenceNotice';
import { useAppStore, useServices } from '../state';

/** Экран первого запуска (п. 4.1). */
export function FirstRunPage() {
  const services = useServices();
  const setReady = useAppStore((s) => s.setReady);
  const setWriteError = useAppStore((s) => s.setWriteError);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [persistence, setPersistence] = useState<PersistenceStatus | undefined>();
  const inputId = useId();
  const errorId = useId();

  useEffect(() => {
    // До запроса статус обычно «не выдано»; предупреждаем заранее, только если API нет вовсе.
    void services.data.persistenceStatus().then((s) => setPersistence(s === 'unsupported' ? s : undefined));
  }, [services]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const profile = await services.profile.create(name);
      await services.data.requestPersistence();
      setReady(profile);
    } catch (e) {
      if (e instanceof ValidationError) setError(e.message);
      else if (e instanceof StorageError && e.kind === 'quota') setWriteError('quota');
      else setError('Не удалось сохранить. Попробуйте ещё раз.');
      setBusy(false);
      document.getElementById(inputId)?.focus();
    }
  }

  return (
    <main className="welcome" id="main">
      <div className="welcome-card">
        <section className="hero welcome-hero">
          <p className="hero-date">Планировщик задач и трекер привычек</p>
          <h1 className="welcome-title">Мой ритм</h1>
        </section>
        <form className="card" onSubmit={(e) => void submit(e)} noValidate>
          <div className="field">
            <label htmlFor={inputId}>Как вас зовут?</label>
            <input
              id={inputId}
              className="input"
              type="text"
              autoComplete="given-name"
              value={name}
              maxLength={60}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(undefined);
              }}
            />
            {error && (
              <p id={errorId} className="field-error">
                {error}
              </p>
            )}
          </div>
          <p className="hint">
            Данные хранятся только в этом браузере на этом устройстве. Чтобы не потерять их, время от времени сохраняйте
            резервную копию в настройках.
          </p>
          <PersistenceWarning status={persistence} />
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            Начать
          </button>
        </form>
        <div className="card">
          <p className="hint">Уже пользовались «Моим ритмом» в другом браузере?</p>
          <ImportBackup
            buttonLabel="Восстановить из резервной копии"
            replacesExisting={false}
            onImported={(profile) => {
              void services.data.requestPersistence();
              setReady(profile);
            }}
          />
        </div>
      </div>
    </main>
  );
}
