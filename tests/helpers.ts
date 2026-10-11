import { toIsoDate } from '../src/domain/dates';
import type { Clock, NotificationPermissionStatus, SystemNotifier } from '../src/repositories';
import { buildDeps } from '../src/composition-root';
import { createServices } from '../src/application/services';

/** Управляемые часы для тестов (п. 16.1). */
export class FakeClock implements Clock {
  constructor(private current: Date = new Date('2026-10-09T10:00:00')) {}
  now(): Date {
    return new Date(this.current.getTime());
  }
  nowIso(): string {
    return this.current.toISOString();
  }
  today(): string {
    return toIsoDate(this.current);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
  set(date: Date): void {
    this.current = date;
  }
}

let counter = 0;

/** Свежая изолированная база в fake-indexeddb. */
export function makeEnv(dbName = `test-db-${++counter}-${Math.random().toString(36).slice(2)}`, systemNotifier: SystemNotifier = new FakeNotifier()) {
  const clock = new FakeClock();
  const deps = buildDeps({ dbName, clock, appVersion: 'test', systemNotifier });
  const services = createServices(deps);
  return { deps, services, clock, dbName };
}

/** Системные уведомления для тестов: запоминает показанные. */
export class FakeNotifier implements SystemNotifier {
  shown: Array<{ title: string; body: string; onClick: () => void }> = [];
  constructor(
    public status: NotificationPermissionStatus = 'granted',
    public hidden = true,
  ) {}
  permission(): NotificationPermissionStatus {
    return this.status;
  }
  async requestPermission(): Promise<NotificationPermissionStatus> {
    if (this.status === 'default') this.status = 'granted';
    return this.status;
  }
  show(title: string, body: string, onClick: () => void): boolean {
    if (this.status !== 'granted') return false;
    this.shown.push({ title, body, onClick });
    return true;
  }
  pageHidden(): boolean {
    return this.hidden;
  }
}
