/** Виды ошибок хранилища, у каждого — свой понятный текст (п. 12.1). */
export type StorageErrorKind = 'unavailable' | 'quota' | 'migration' | 'newer-version' | 'unknown';

export class StorageError extends Error {
  constructor(
    readonly kind: StorageErrorKind,
    readonly original?: unknown,
  ) {
    super(`Ошибка хранилища: ${kind}`);
    this.name = 'StorageError';
  }
}

/** Открытие хранилища и аварийная выгрузка «сырых» данных при неудачной миграции. */
export interface StorageGateway {
  open(): Promise<void>;
  /** Вызывается, когда другая вкладка обновила схему базы. */
  onVersionChange(listener: () => void): void;
  /** Читает все хранилища базы без привязки к версии схемы. */
  exportRaw(): Promise<Record<string, unknown[]>>;
}
