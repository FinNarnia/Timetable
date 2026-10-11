import { MAX_BACKUP_BYTES, parseBackupText, type BackupParseResult } from './parseBackup';

export class ParseCancelledError extends Error {
  constructor() {
    super('Проверка файла отменена');
    this.name = 'ParseCancelledError';
  }
}

function readText(file: Blob): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/**
 * Проверка файла копии: в Web Worker, а если он недоступен — в основном потоке (п. 4.4, 15.3).
 * Отмена через AbortSignal: воркер завершается, данные не меняются.
 */
export class BackupParser {
  constructor(private readonly schemaVersion: number) {}

  async parse(file: Blob, signal?: AbortSignal): Promise<BackupParseResult> {
    if (file.size > MAX_BACKUP_BYTES) return { ok: false, error: 'too-large' };
    const text = await readText(file);
    if (signal?.aborted) throw new ParseCancelledError();
    if (typeof Worker === 'function') {
      try {
        return await this.parseInWorker(text, signal);
      } catch (error) {
        if (error instanceof ParseCancelledError) throw error;
        // Воркер не запустился (например, запрещён политикой) — проверяем в основном потоке.
      }
    }
    const result = parseBackupText(text, this.schemaVersion);
    if (signal?.aborted) throw new ParseCancelledError();
    return result;
  }

  private parseInWorker(text: string, signal?: AbortSignal): Promise<BackupParseResult> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' });
      const cleanup = () => {
        worker.terminate();
        signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        cleanup();
        reject(new ParseCancelledError());
      };
      signal?.addEventListener('abort', onAbort);
      worker.onmessage = (event: MessageEvent<BackupParseResult>) => {
        cleanup();
        resolve(event.data);
      };
      worker.onerror = (event) => {
        event.preventDefault();
        cleanup();
        reject(new Error('Worker failed'));
      };
      worker.postMessage({ text, schemaVersion: this.schemaVersion });
    });
  }
}
