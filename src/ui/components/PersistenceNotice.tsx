import type { PersistenceStatus } from '../../application/public';

/** Предупреждение, если браузер не дал устойчивое хранилище (п. 4.5). Зависит от результата запроса, а не от браузера. */
export function PersistenceWarning({ status }: { status: PersistenceStatus | undefined }) {
  if (status !== 'not-persisted' && status !== 'unsupported') return null;
  return (
    <div className="notice notice-warning" role="note">
      <p className="notice-title">Данные могут быть удалены браузером</p>
      <p>
        Браузер может удалить локальные данные после длительного перерыва в использовании. Регулярно сохраняйте
        резервную копию.
      </p>
    </div>
  );
}

export const PERSISTENCE_STATUS_TEXT: Record<PersistenceStatus, string> = {
  persisted: 'Браузер не удалит данные автоматически',
  'not-persisted': 'Браузер может удалить данные при нехватке места или долгом перерыве',
  unsupported: 'Браузер может удалить данные при нехватке места или долгом перерыве',
};
