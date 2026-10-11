import { toIsoDate } from '../domain/dates';
import type { Clock } from '../repositories';

/** Единственное место, где приложение читает системное время (п. 10.2). */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  nowIso(): string {
    return new Date().toISOString();
  }

  today(): string {
    return toIsoDate(new Date());
  }
}
