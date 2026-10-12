import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { Services } from '../application/services';
import { StorageError } from '../application/public';
import { AppShell } from './AppShell';
import { ReportsPage } from './pages/ReportsPage';
import { HabitsPage } from './pages/HabitsPage';
import { FirstRunPage } from './pages/FirstRunPage';
import { SettingsPage } from './pages/SettingsPage';
import { TodayPage } from './pages/TodayPage';
import { UpcomingPage } from './pages/UpcomingPage';
import { ServicesContext, useAppStore, type Toast } from './state';
import { useOpenTomorrow } from './components/Reminder';
import { StorageErrorScreen, WriteErrorBanner } from './StorageErrorScreen';
import { runMaintenance } from './maintenance';

/** Приложение может жить не в корне сайта (fin-narnia.online/timetable/): база берётся из сборки. */
const ROUTER_BASENAME = import.meta.env.BASE_URL === '/' ? undefined : import.meta.env.BASE_URL.replace(/\/$/, '');

export function App({ services }: { services: Services }) {
  return (
    <ServicesContext.Provider value={services}>
      <BrowserRouter basename={ROUTER_BASENAME}>
        <Bootstrap services={services} />
        <DayWatcher services={services} />
        <ReminderWatcher services={services} />
        <Root />
        <Blocker />
        <WriteErrorBanner />
        <Toasts />
        <Announcer />
      </BrowserRouter>
    </ServicesContext.Provider>
  );
}

/** Запуск: открытие хранилища, загрузка профиля, подписка на события других вкладок. */
function Bootstrap({ services }: { services: Services }) {
  const setReady = useAppStore((s) => s.setReady);
  const setFirstRun = useAppStore((s) => s.setFirstRun);
  const setFatal = useAppStore((s) => s.setFatal);
  const setBlocker = useAppStore((s) => s.setBlocker);

  useEffect(() => {
    let cancelled = false;
    services.profile
      .start()
      .then(async (profile) => {
        if (cancelled) return;
        if (!profile) {
          setFirstRun();
          return;
        }
        // Обслуживание дня — до первого показа экранов, чтобы не мелькали вчерашние задачи (п. 10.2).
        await runMaintenance(services);
        if (!cancelled) setReady(profile);
      })
      .catch((error: unknown) => {
        if (!cancelled) setFatal(error instanceof StorageError ? error.kind : 'unknown');
      });
    services.data.onVersionChange(() => setFatal('newer-version'));
    const unsubscribe = services.data.onTabMessage((message) => {
      // Изменения в другой вкладке — перечитать данные (п. 10.3).
      if (message.type === 'data-changed') useAppStore.getState().bumpData();
      // Уведомление показала другая вкладка — внутреннее показываем и здесь (п. 10.3).
      if (message.type === 'reminder') {
        const { setReminder, setReminderDay } = useAppStore.getState();
        setReminder({ title: message.title, titles: message.titles, count: message.count });
        setReminderDay(services.clock.today());
      }
      if (message.type === 'data-replace-started') setBlocker('Данные обновляются в другой вкладке…');
      if (message.type === 'data-replace-failed') setBlocker(undefined);
      if (message.type === 'data-replaced') window.location.reload();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [services, setReady, setFirstRun, setFatal, setBlocker]);

  return null;
}

/**
 * Смена дня при открытом приложении (п. 10.2): проверка при запуске, каждые 60 секунд и при focus / visibilitychange.
 * Там же — запасной вариант без BroadcastChannel: при возвращении во вкладку данные перечитываются (п. 10.3).
 */
function DayWatcher({ services }: { services: Services }) {
  const status = useAppStore((s) => s.status);
  useEffect(() => {
    if (status !== 'ready') return;
    let running = false;
    const check = async () => {
      const { day, bumpData } = useAppStore.getState();
      if (running || day === services.clock.today()) return;
      running = true;
      await runMaintenance(services);
      running = false;
      bumpData();
    };
    const onFocus = () => {
      void check();
      useAppStore.getState().bumpData();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') onFocus();
    };
    void check(); // после первого запуска (профиль только что создан) день ещё не отмечен
    const timer = setInterval(() => void check(), 60_000);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [status, services]);
  return null;
}

/**
 * Вечернее уведомление (п. 10.1): проверка при запуске, каждые 60 секунд и при focus / visibilitychange.
 * Показ — ровно один раз в день при любом числе вкладок: решает ReminderService (транзакция + Web Locks).
 */
function ReminderWatcher({ services }: { services: Services }) {
  const status = useAppStore((s) => s.status);
  const openTomorrow = useOpenTomorrow();
  const open = useRef(openTomorrow);
  open.current = openTomorrow;
  useEffect(() => {
    if (status !== 'ready') return;
    let running = false;
    let again = false;
    const once = async () => {
      try {
        const { setReminder, setReminderDay } = useAppStore.getState();
        if (await services.reminder.shownToday()) setReminderDay(services.clock.today());
        const content = await services.reminder.check(() => open.current());
        if (content) {
          setReminder(content);
          setReminderDay(services.clock.today());
        }
      } catch {
        // Уведомление необязательно: ошибка чтения не мешает работе (п. 15.5).
      }
    };
    // Запрос, пришедший во время проверки (таймер после сна, focus), не теряется: проверка повторяется с новым временем.
    const check = async () => {
      if (running) {
        again = true;
        return;
      }
      running = true;
      do {
        again = false;
        await once();
      } while (again);
      running = false;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void check();
    };
    const onFocus = () => void check();
    void check();
    const timer = setInterval(() => void check(), 60_000);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [status, services]);
  return null;
}

function Root() {
  const status = useAppStore((s) => s.status);
  const fatalError = useAppStore((s) => s.fatalError);

  if (status === 'loading') return <LoadingScreen />;
  if (status === 'fatal') return <StorageErrorScreen kind={fatalError ?? 'unknown'} />;
  if (status === 'first-run') return <FirstRunPage />;
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<TodayPage />} />
        <Route path="upcoming" element={<UpcomingPage />} />
        <Route path="habits" element={<HabitsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function LoadingScreen() {
  return (
    <main className="main" aria-busy="true" aria-label="Загрузка">
      <div className="skeleton skeleton-hero" />
      <div className="skeleton skeleton-line" />
      <div className="skeleton skeleton-line" />
    </main>
  );
}

/** Объявления для скринридера (aria-live="polite"). Ключ по id — повторный текст объявляется снова. */
function Announcer() {
  const announcement = useAppStore((s) => s.announcement);
  return (
    <div className="visually-hidden" aria-live="polite" aria-atomic="true" data-testid="announcer">
      {announcement && <span key={announcement.id}>{announcement.text}</span>}
    </div>
  );
}

function Blocker() {
  const text = useAppStore((s) => s.blocker);
  if (!text) return null;
  return (
    <div className="blocker" role="alertdialog" aria-modal="true" aria-labelledby="blocker-text">
      <div className="blocker-card">
        <div className="spinner" aria-hidden="true" />
        <p id="blocker-text">{text}</p>
      </div>
    </div>
  );
}

function Toasts() {
  const toasts = useAppStore((s) => s.toasts);
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}

/** Тост закрывается сам; при наведении или фокусе таймер на паузе (п. 12.4). */
function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useAppStore((s) => s.dismissToast);
  const [paused, setPaused] = useState(false);
  const remaining = useRef(toast.duration);
  const startedAt = useRef(0);

  useEffect(() => {
    if (paused) return;
    startedAt.current = performance.now();
    const timer = setTimeout(() => dismiss(toast.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= performance.now() - startedAt.current;
    };
  }, [paused, dismiss, toast.id]);

  return (
    <div
      className="toast"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span>{toast.text}</span>
      {toast.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            toast.action!.run();
            dismiss(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
