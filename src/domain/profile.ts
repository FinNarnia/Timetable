import type { IsoDateTime, Profile, UserSettings } from './types';

export const PROFILE_NAME_MIN = 2;
export const PROFILE_NAME_MAX = 50;

export type NameValidation = { ok: true; value: string } | { ok: false; error: string };

/** Имя профиля: 2–50 символов после удаления пробелов по краям (п. 4.1). */
export function validateProfileName(raw: string): NameValidation {
  const value = raw.trim();
  const length = [...value].length;
  if (length === 0) return { ok: false, error: 'Введите имя' };
  if (length < PROFILE_NAME_MIN) return { ok: false, error: 'Имя должно быть не короче 2 символов' };
  if (length > PROFILE_NAME_MAX) return { ok: false, error: 'Имя должно быть не длиннее 50 символов' };
  return { ok: true, value };
}

export const DEFAULT_REMINDER_TIME = '20:00';

export function defaultSettings(userId: string, now: IsoDateTime): UserSettings {
  return {
    userId,
    locale: 'ru-RU',
    weekStartsOn: 1,
    eveningReminderEnabled: true,
    eveningReminderTime: DEFAULT_REMINDER_TIME,
    lastReminderDate: null,
    lastMaintenanceDate: null,
    lastExportAt: null,
    backupBannerDismissedAt: null,
    updatedAt: now,
  };
}

export function makeProfile(id: string, name: string, now: IsoDateTime): Profile {
  return { id, name, createdAt: now, updatedAt: now };
}

export const PERSONAL_CALENDAR_NAME = 'Личный';
