import type { StorageErrorKind } from '../application/public';
import { downloadFile, useAppStore, useServices } from './state';

const TEXT: Record<StorageErrorKind, { title: string; text: string }> = {
  unavailable: {
    title: 'Браузер не разрешает сохранять данные',
    text: 'Откройте приложение в обычном окне, не в режиме инкогнито, и проверьте, что сайту разрешено хранить данные.',
  },
  quota: {
    title: 'Не хватает места для сохранения',
    text: 'Скачайте резервную копию и освободите место на устройстве.',
  },
  migration: {
    title: 'Не удалось обновить данные',
    text: 'Ваши данные не удалены. Скачайте их, чтобы они точно не потерялись, и обновите страницу.',
  },
  'newer-version': {
    title: 'Вышла новая версия',
    text: 'Приложение обновилось в другой вкладке. Обновите страницу, чтобы продолжить.',
  },
  unknown: {
    title: 'Не удалось открыть данные',
    text: 'Обновите страницу. Если ошибка повторяется, сохраните резервную копию.',
  },
};

/** Экран критической ошибки хранилища (п. 12.1). Без технических подробностей. */
export function StorageErrorScreen({ kind }: { kind: StorageErrorKind }) {
  const services = useServices();
  const { title, text } = TEXT[kind];

  async function exportRaw() {
    const file = await services.data.exportRaw();
    downloadFile(file.fileName, file.content);
  }

  return (
    <main className="full-screen-message" id="main">
      <section className="card" role="alert" aria-labelledby="fatal-title">
        <h1 id="fatal-title" className="dialog-title">
          {title}
        </h1>
        <p>{text}</p>
        <div className="button-row">
          {kind === 'migration' && (
            <button type="button" className="btn btn-dark" onClick={() => void exportRaw()}>
              Скачать данные
            </button>
          )}
          {kind !== 'unavailable' && (
            <button type="button" className="btn btn-secondary" onClick={() => window.location.reload()}>
              Обновить страницу
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

/** Баннер ошибки записи поверх обычного экрана (п. 12.1, 12.4). */
export function WriteErrorBanner() {
  const services = useServices();
  const kind = useAppStore((s) => s.writeError);
  const setWriteError = useAppStore((s) => s.setWriteError);
  if (!kind) return null;
  const { title, text } = TEXT[kind === 'quota' ? 'quota' : 'unknown'];

  async function exportBackup() {
    try {
      const file = await services.data.exportBackup();
      downloadFile(file.fileName, file.content);
    } catch {
      const raw = await services.data.exportRaw();
      downloadFile(raw.fileName, raw.content);
    }
  }

  return (
    <div className="blocker" role="alertdialog" aria-labelledby="write-error-title" aria-describedby="write-error-text">
      <div className="card blocker-card">
        <h2 id="write-error-title" className="dialog-title">
          {title}
        </h2>
        <p id="write-error-text">{text}</p>
        <div className="button-row">
          <button type="button" className="btn btn-dark" onClick={() => void exportBackup()}>
            Скачать резервную копию
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setWriteError(undefined)}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
