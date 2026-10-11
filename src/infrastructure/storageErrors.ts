import type { StorageErrorKind } from '../repositories/errors';

function names(error: unknown): string[] {
  const result: string[] = [];
  let current: unknown = error;
  for (let i = 0; i < 5 && current && typeof current === 'object'; i++) {
    const e = current as { name?: unknown; inner?: unknown; cause?: unknown };
    if (typeof e.name === 'string') result.push(e.name);
    current = e.inner ?? e.cause;
  }
  return result;
}

/** Переводит ошибку IndexedDB/Dexie в один из видов п. 12.1. */
export function classifyStorageError(error: unknown): StorageErrorKind {
  const all = names(error);
  if (all.includes('QuotaExceededError')) return 'quota';
  if (all.includes('VersionError')) return 'newer-version';
  if (all.includes('UpgradeError')) return 'migration';
  if (all.some((n) => ['MissingAPIError', 'InvalidStateError', 'SecurityError', 'InvalidAccessError'].includes(n))) {
    return 'unavailable';
  }
  return 'unknown';
}
