// Иконки — штриховые SVG, декоративные (подпись всегда рядом текстом).
type IconProps = { size?: number };

const common = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
});

export function TodayIcon({ size = 22 }: IconProps) {
  return (
    <svg {...common(size)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12l2.5 2.5 4.5-5" />
    </svg>
  );
}

export function UpcomingIcon({ size = 22 }: IconProps) {
  return (
    <svg {...common(size)}>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </svg>
  );
}

export function HabitsIcon({ size = 22 }: IconProps) {
  return (
    <svg {...common(size)}>
      <path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" />
    </svg>
  );
}

export function ReportsIcon({ size = 22 }: IconProps) {
  return (
    <svg {...common(size)}>
      <path d="M5 20V11M12 20V5M19 20v-6" />
    </svg>
  );
}

export function SettingsIcon({ size = 22 }: IconProps) {
  return (
    <svg {...common(size)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
    </svg>
  );
}
