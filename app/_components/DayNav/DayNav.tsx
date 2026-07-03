import Link from 'next/link';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';

type DayNavProps = {
  dayParam: string;
  prevDayParam: string;
  nextDayParam: string;
  todayParam: string;
  isToday: boolean;
  /** True when ?fine=1 is set — preserves the toggle in nav links. */
  fine: boolean;
};

/**
 * Day switcher — brutally simple (DEC-P2).
 *
 * Layout: [‹ Jučer]  <big date label>  [Sutra ›]  [Danas] (only when !isToday)
 *
 * Each nav item is a plain <Link> to /?day={param}[&fine=1].
 * Zero JS needed — pure server component, full page navigation.
 *
 * Server component — pure props → JSX.
 */
export function DayNav({
  dayParam,
  prevDayParam,
  nextDayParam,
  todayParam,
  isToday,
  fine,
}: DayNavProps) {
  const fineQuery = fine ? '&fine=1' : '';

  // Parse dayParam YYYY-MM-DD to Croatian display string.
  // Using Intl so the server locale is consistent.
  const [year, month, day] = dayParam.split('-').map(Number);
  const displayDate = new Date(Date.UTC(year!, month! - 1, day!, 12));

  const weekdayLabel = displayDate.toLocaleDateString('hr-HR', {
    timeZone: 'Europe/Zagreb',
    weekday: 'long',
  });
  const dateLabel = displayDate.toLocaleDateString('hr-HR', {
    timeZone: 'Europe/Zagreb',
    day: 'numeric',
    month: 'long',
  });

  return (
    <nav
      className="flex items-center justify-between gap-2 px-4 py-3 bg-card border-b border-border"
      aria-label="Navigacija po danima"
    >
      {/* Prev day */}
      <Link
        href={`/?day=${prevDayParam}${fineQuery}`}
        className="flex items-center gap-1 rounded-xl px-3 py-2 text-sm font-semibold text-muted-foreground bg-muted hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95 transition-all min-h-11"
        aria-label="Prethodni dan"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        <span className="hidden xs:inline">Jučer</span>
      </Link>

      {/* Current day label — centre, large */}
      <div className="flex flex-col items-center flex-1 min-w-0">
        <p
          className="font-extrabold text-foreground text-board leading-tight capitalize truncate max-w-full"
          aria-current={isToday ? 'date' : undefined}
        >
          {weekdayLabel}
        </p>
        <p className="text-muted-foreground text-sm font-medium tabular-nums">
          {dateLabel}
        </p>
        {isToday && (
          <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-xs font-bold text-primary-foreground">
            Danas
          </span>
        )}
      </div>

      {/* Next day + Today */}
      <div className="flex items-center gap-1.5">
        {!isToday && (
          <Link
            href={`/?day=${todayParam}${fineQuery}`}
            className="flex items-center gap-1 rounded-xl px-3 py-2 text-sm font-semibold text-primary-foreground bg-primary hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95 transition-all min-h-11"
            aria-label="Idi na danas"
          >
            <Calendar className="h-4 w-4" aria-hidden="true" />
            <span className="hidden xs:inline">Danas</span>
          </Link>
        )}
        <Link
          href={`/?day=${nextDayParam}${fineQuery}`}
          className="flex items-center gap-1 rounded-xl px-3 py-2 text-sm font-semibold text-muted-foreground bg-muted hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95 transition-all min-h-11"
          aria-label="Sljedeći dan"
        >
          <span className="hidden xs:inline">Sutra</span>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </nav>
  );
}
