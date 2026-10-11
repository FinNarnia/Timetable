import { StorageError, type StorageGateway } from '../repositories/errors';
import { SCHEMA_VERSION, type MoyRitmDb } from './db';
import { classifyStorageError } from './storageErrors';

export class IndexedDbGateway implements StorageGateway {
  private versionListeners: Array<() => void> = [];

  constructor(private readonly db: MoyRitmDb) {
    // Другая вкладка открыла базу более новой версии: закрываем соединение и просим обновить страницу (п. 14.4).
    this.db.on('versionchange', () => {
      this.db.close();
      this.versionListeners.forEach((l) => l());
      return false;
    });
  }

  async open(): Promise<void> {
    if (typeof indexedDB === 'undefined') throw new StorageError('unavailable');
    try {
      await this.db.open();
    } catch (error) {
      throw new StorageError(classifyStorageError(error), error);
    }
    // Dexie 4 умеет открыть базу более новой версии, но схема могла измениться несовместимо:
    // старая вкладка не должна с ней работать (п. 12.1, 14.4).
    // Dexie хранит версию в базе умноженной на 10; db.verno при этом показывает объявленную, поэтому смотрим на «родную».
    if (this.db.backendDB().version > SCHEMA_VERSION * 10) {
      this.db.close();
      throw new StorageError('newer-version');
    }
  }

  onVersionChange(listener: () => void): void {
    this.versionListeners.push(listener);
  }

  /** Открывает базу без указания версии и читает все хранилища как есть. */
  exportRaw(): Promise<Record<string, unknown[]>> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.db.name);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const raw = request.result;
        const storeNames = Array.from(raw.objectStoreNames);
        const result: Record<string, unknown[]> = {};
        if (storeNames.length === 0) {
          raw.close();
          resolve(result);
          return;
        }
        const tx = raw.transaction(storeNames, 'readonly');
        for (const name of storeNames) {
          const req = tx.objectStore(name).getAll();
          req.onsuccess = () => {
            result[name] = req.result;
          };
        }
        tx.oncomplete = () => {
          raw.close();
          resolve(result);
        };
        tx.onerror = () => {
          raw.close();
          reject(tx.error);
        };
      };
    });
  }
}
