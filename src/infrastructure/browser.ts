import { v7 as uuidv7 } from 'uuid';
import type {
  ChangeNotifier,
  IdentityProvider,
  LockProvider,
  NotificationPermissionStatus,
  SystemNotifier,
  IdGenerator,
  PersistenceStatus,
  StoragePersistence,
  TabChannel,
  TabMessage,
} from '../repositories';

export class UuidV7Generator implements IdGenerator {
  next(): string {
    return uuidv7();
  }
}

/** В MVP профиль один; облачная реализация заменит этот класс без изменений UI и домена (п. 4.2). */
export class LocalIdentityProvider implements IdentityProvider {
  private userId: string | undefined;

  currentUserId(): string | undefined {
    return this.userId;
  }

  requireUserId(): string {
    if (!this.userId) throw new Error('Профиль ещё не создан');
    return this.userId;
  }

  setCurrentUserId(userId: string | undefined): void {
    this.userId = userId;
  }
}

/** navigator.storage.persist() с проверкой наличия API (п. 4.5, 15.3). */
export class BrowserStoragePersistence implements StoragePersistence {
  async status(): Promise<PersistenceStatus> {
    const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!storage || typeof storage.persisted !== 'function') return 'unsupported';
    try {
      return (await storage.persisted()) ? 'persisted' : 'not-persisted';
    } catch {
      return 'unsupported';
    }
  }

  async request(): Promise<PersistenceStatus> {
    const current = await this.status();
    if (current !== 'not-persisted') return current;
    try {
      return (await navigator.storage.persist()) ? 'persisted' : 'not-persisted';
    } catch {
      return 'not-persisted';
    }
  }
}

const CHANNEL_NAME = 'moy-ritm';

/** BroadcastChannel между вкладками; без него — тихая заглушка (п. 10.3, 15.3). */
export class BroadcastTabChannel implements TabChannel {
  private readonly channel: BroadcastChannel | undefined;

  constructor() {
    this.channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL_NAME) : undefined;
  }

  post(message: TabMessage): void {
    this.channel?.postMessage(message);
  }

  subscribe(listener: (message: TabMessage) => void): () => void {
    if (!this.channel) return () => {};
    const handler = (event: MessageEvent<TabMessage>) => listener(event.data);
    this.channel.addEventListener('message', handler);
    return () => this.channel?.removeEventListener('message', handler);
  }
}

/** Собирает изменённые сущности и одним сообщением рассылает их другим вкладкам (п. 10.3). */
export class TabChangeNotifier implements ChangeNotifier {
  private pending = new Set<string>();
  private scheduled = false;

  constructor(private readonly tabs: TabChannel) {}

  touch(entity: string): void {
    this.pending.add(entity);
    if (this.scheduled) return;
    this.scheduled = true;
    setTimeout(() => {
      const entities = [...this.pending];
      this.pending.clear();
      this.scheduled = false;
      this.tabs.post({ type: 'data-changed', entities });
    }, 0);
  }
}

/** navigator.locks, если есть; иначе функция выполняется сразу — корректность обеспечивают транзакции (п. 10.3). */
export class WebLockProvider implements LockProvider {
  run<R>(name: string, fn: () => Promise<R>): Promise<R> {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    if (!locks || typeof locks.request !== 'function') return fn();
    return locks.request(name, fn) as Promise<R>;
  }
}

/** Notification API с проверкой наличия (п. 10.1, 15.3): на iOS вне установленного веб-приложения его нет. */
export class BrowserSystemNotifier implements SystemNotifier {
  private supported(): boolean {
    return typeof window !== 'undefined' && typeof window.Notification === 'function';
  }

  permission(): NotificationPermissionStatus {
    if (!this.supported()) return 'unsupported';
    return Notification.permission;
  }

  async requestPermission(): Promise<NotificationPermissionStatus> {
    if (!this.supported()) return 'unsupported';
    try {
      return await Notification.requestPermission();
    } catch {
      return this.permission();
    }
  }

  show(title: string, body: string, onClick: () => void): boolean {
    if (this.permission() !== 'granted') return false;
    try {
      const n = new Notification(title, { body, tag: 'moy-ritm-reminder', lang: 'ru' });
      n.onclick = () => {
        window.focus();
        onClick();
        n.close();
      };
      return true;
    } catch {
      return false; // например, Android Chrome требует Service Worker — остаётся внутреннее уведомление
    }
  }

  pageHidden(): boolean {
    return typeof document !== 'undefined' && (document.visibilityState === 'hidden' || !document.hasFocus());
  }
}
