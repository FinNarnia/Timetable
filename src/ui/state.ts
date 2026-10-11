import { createContext, useContext } from 'react';
import { create } from 'zustand';
import type { Services } from '../application/services';
import type { Profile } from '../domain/types';
import type { StorageErrorKind } from '../application/public';
import type { ReminderContent } from '../domain/reminder';

export const ServicesContext = createContext<Services | null>(null);

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('ServicesContext не задан');
  return services;
}

export type ToastAction = { label: string; run: () => void };
export type Toast = { id: number; text: string; action?: ToastAction; duration: number };

type AppState = {
  status: 'loading' | 'first-run' | 'ready' | 'fatal';
  profile: Profile | undefined;
  fatalError: StorageErrorKind | undefined;
  /** Ошибка записи (например, нет места) — показывается баннером поверх экрана. */
  writeError: StorageErrorKind | undefined;
  /** Блокировка редактирования на время массовой записи (п. 4.4, 10.3). */
  blocker: string | undefined;
  toasts: Toast[];
  /** Текст для скринридера (aria-live), без видимого сообщения: позиция задачи, число найденных (п. 6.13, 7.4). */
  announcement: { id: number; text: string } | undefined;
  announce: (text: string) => void;
  /** Текущий календарный день приложения; меняется после обслуживания дня (п. 10.2). */
  day: string | undefined;
  setDay: (day: string) => void;
  /** Счётчик изменений данных: растёт после обслуживания дня и при изменениях в других вкладках (п. 10.3). */
  dataVersion: number;
  bumpData: () => void;
  /** Внутреннее вечернее уведомление на экране (п. 10.1): висит, пока его не закроют. */
  reminder: ReminderContent | undefined;
  setReminder: (content: ReminderContent | undefined) => void;
  /** День, в который уведомление уже показывали: до полуночи на «Сегодня» доступен блок «Завтра». */
  reminderDay: string | undefined;
  setReminderDay: (day: string) => void;
  setReady: (profile: Profile) => void;
  setFirstRun: () => void;
  setFatal: (kind: StorageErrorKind) => void;
  setWriteError: (kind: StorageErrorKind | undefined) => void;
  setBlocker: (text: string | undefined) => void;
  /** Сообщение: 4 секунды, с действием «Отменить» — 5 секунд (п. 12.4). */
  toast: (text: string, action?: ToastAction) => void;
  dismissToast: (id: number) => void;
};

let toastId = 0;

export const useAppStore = create<AppState>((set) => ({
  status: 'loading',
  profile: undefined,
  fatalError: undefined,
  writeError: undefined,
  blocker: undefined,
  toasts: [],
  announcement: undefined,
  announce: (text) => set({ announcement: { id: ++toastId, text } }),
  day: undefined,
  setDay: (day) => set({ day }),
  dataVersion: 0,
  bumpData: () => set((s) => ({ dataVersion: s.dataVersion + 1 })),
  reminder: undefined,
  setReminder: (reminder) => set({ reminder }),
  reminderDay: undefined,
  setReminderDay: (reminderDay) => set({ reminderDay }),
  setReady: (profile) => set({ status: 'ready', profile }),
  setFirstRun: () => set({ status: 'first-run', profile: undefined }),
  setFatal: (kind) => set({ status: 'fatal', fatalError: kind }),
  setWriteError: (kind) => set({ writeError: kind }),
  setBlocker: (text) => set({ blocker: text }),
  toast: (text, action) => {
    const id = ++toastId;
    const duration = action ? 5000 : 4000;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, action, duration }] }));
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Скачивание файла, созданного в браузере. */
export function downloadFile(fileName: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
