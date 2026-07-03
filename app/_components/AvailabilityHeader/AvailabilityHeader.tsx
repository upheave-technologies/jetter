import type { DayBoard } from '@/modules/bookings/domain/types';
import { JetterLogo } from '@/app/_components/JetterLogo/JetterLogo';
import { formatHHMM } from '@/lib/time';

// Fleet baseline for "X/6" display — mirrors domain FLEET_SIZE = 6 (DEC-P10, 2026-07-03 fleet reduction 8→6).
// Kept as a local display constant; not imported from domain/config (app→domain boundary).
const FLEET = 6;

type AvailabilityHeaderProps = {
  board: Pick<DayBoard, 'freeNow' | 'nextOpeningAt' | 'now' | 'isToday' | 'utilization'>;
};

/**
 * Sticky top bar — brand lockup + availability hero + clock.
 *
 * When isToday and freeNow !== null:
 *   Shows "Slobodno sada: N/6" with colour-coded emphasis.
 *   If freeNow < FLEET and nextOpeningAt set: shows "Sljedeći slobodan termin u HH:MM".
 *   If freeNow === 0 and no nextOpeningAt: shows "Sve zauzeto — nema slobodnih termina danas".
 *
 * When !isToday (freeNow is null):
 *   Shows the day's utilization headline instead: "Iskorištenost: NN%".
 *
 * Server component — pure props → JSX.
 */
export function AvailabilityHeader({ board }: AvailabilityHeaderProps) {
  const { freeNow, nextOpeningAt, now, isToday, utilization } = board;

  const timeStr = now.toLocaleTimeString('hr-HR', {
    timeZone: 'Europe/Zagreb',
    hour: '2-digit',
    minute: '2-digit',
  });

  // Live free-now display — only meaningful today
  const showFreeNow = isToday && freeNow !== null;
  const effectiveFree = freeNow ?? 0;

  const freeColor =
    effectiveFree === 0
      ? 'text-destructive'
      : effectiveFree <= 2
        ? 'text-warning'
        : 'text-success';

  const freeBg =
    effectiveFree === 0
      ? 'bg-destructive/10 ring-1 ring-destructive/25'
      : effectiveFree <= 2
        ? 'bg-warning/10 ring-1 ring-warning/25'
        : 'bg-success/10 ring-1 ring-success/25';

  return (
    <header
      className="sticky top-0 z-20 border-b border-border bg-card overflow-hidden shadow-card-md"
      role="banner"
    >
      {/* ---------------------------------------------------------------- */}
      {/* Main header row                                                   */}
      {/* ---------------------------------------------------------------- */}
      <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
        {/* Brand lockup — logo + wordmark */}
        <JetterLogo className="text-primary shrink-0" />

        {/* Availability hero — free-now today / utilization other days */}
        {showFreeNow ? (
          <div
            className={`flex items-baseline gap-1.5 rounded-xl px-3 py-1.5 ${freeBg}`}
            aria-label={`${effectiveFree} od ${FLEET} skutera slobodnih sada`}
          >
            <span
              className={`font-extrabold leading-none tabular-nums text-board-xl ${freeColor}`}
            >
              {effectiveFree}
            </span>
            <span className={`font-semibold text-board ${freeColor} opacity-80`}>
              /{FLEET}
            </span>
            <span className={`font-semibold text-board ${freeColor} opacity-80`}>
              slobodnih
            </span>
          </div>
        ) : (
          <div
            className="flex items-baseline gap-1.5 rounded-xl px-3 py-1.5 bg-muted/40"
            aria-label={`Iskorištenost dana: ${Math.round(utilization.utilizationPct)}%`}
          >
            <span className="font-extrabold leading-none tabular-nums text-board-xl text-foreground">
              {Math.round(utilization.utilizationPct)}
            </span>
            <span className="font-semibold text-board text-muted-foreground opacity-80">
              %
            </span>
          </div>
        )}

        {/* Clock — rightmost, muted, monospace feel */}
        <time
          dateTime={now.toISOString()}
          className="text-muted-foreground font-mono font-medium tabular-nums text-board shrink-0"
          aria-label={`Trenutno vrijeme: ${timeStr}`}
        >
          {timeStr}
        </time>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Sub-line: next opening / fully booked / utilization label        */}
      {/* ---------------------------------------------------------------- */}
      {showFreeNow && effectiveFree < FLEET && nextOpeningAt !== null && (
        <p
          className="px-4 pb-2 text-sm text-muted-foreground"
          aria-live="polite"
        >
          Sljedeći slobodan termin u{' '}
          <strong className="font-bold text-foreground">
            {formatHHMM(nextOpeningAt)}
          </strong>
        </p>
      )}

      {showFreeNow && effectiveFree === 0 && nextOpeningAt === null && (
        <p
          className="px-4 pb-2 text-sm font-semibold text-destructive"
          aria-live="polite"
        >
          Sve zauzeto — nema slobodnih termina danas
        </p>
      )}

      {!isToday && (
        <p className="px-4 pb-2 text-sm text-muted-foreground">
          Iskorištenost
        </p>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Decorative wave — bottom edge, purely visual, aria-hidden         */}
      {/* ---------------------------------------------------------------- */}
      <div aria-hidden="true" className="relative h-5 overflow-hidden">
        <svg
          viewBox="0 0 400 20"
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full text-decor-wave"
        >
          <path
            d="M0 12 C50 4 100 18 150 10 C200 2 250 16 300 8 C350 2 380 14 400 10 L400 20 L0 20 Z"
            fill="currentColor"
          />
        </svg>
      </div>
    </header>
  );
}
