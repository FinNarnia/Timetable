import { NavLink, Outlet } from 'react-router-dom';
import { ReminderNotice } from './components/Reminder';
import { HabitsIcon, ReportsIcon, SettingsIcon, TodayIcon, UpcomingIcon } from './components/icons';

// Мягкие переносы (\u00AD): на узком экране длинные подписи переносятся по слогам, а не посреди буквы.
const NAV = [
  { to: '/', label: 'Сегодня', Icon: TodayIcon, end: true },
  { to: '/upcoming', label: 'Пред\u00ADстоящие', Icon: UpcomingIcon, end: false },
  { to: '/habits', label: 'Привычки', Icon: HabitsIcon, end: false },
  { to: '/reports', label: 'Отчёты', Icon: ReportsIcon, end: false },
  { to: '/settings', label: 'Настрой\u00ADки', Icon: SettingsIcon, end: false },
];

/** Пять разделов: снизу до 768 px, сбоку от 768 px (п. 5). */
export function AppShell() {
  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Перейти к содержимому
      </a>
      <nav className="nav" aria-label="Основная навигация">
        <div className="nav-brand">Мой ритм</div>
        <ul className="nav-list">
          {NAV.map(({ to, label, Icon, end }) => (
            <li key={to}>
              <NavLink to={to} end={end} className="nav-link">
                <Icon />
                <span>{label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <main id="main" className="main" tabIndex={-1}>
        <ReminderNotice />
        <Outlet />
      </main>
    </div>
  );
}
