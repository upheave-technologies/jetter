import Link from 'next/link';
import type { DensityBucket } from '@/modules/bookings/domain/types';

// Fleet baseline for bar height math — matches SPEC non-negotiable.
// Named constant with comment; not imported from domain/config (layer boundary).
const FLEET = 8;

type DensityChartProps = {
  density: DensityBucket[];
  bucketMin: number;
  dayParam: string;
  fine: boolean;
  windowStart: Date | null;
  windowEnd: Date | null;
};

/**
 * Reservation density chart — popular-times-style vertical bar chart (DEC-P4).
 *
 * Each bar encodes committed scooters (reserved + maintenance) for one time bucket.
 * The bar is stacked: reserved (primary token) bottom, maintenance (warning token) top.
 * The fleet ceiling (FLEET=8) is the full bar height; a full bar = fully booked.
 *
 * X-axis hour labels appear only for buckets within [windowStart, windowEnd].
 * Bucket-size toggle: [5 min] / [15 min] links (preserve ?day param).
 *
 * Server component — pure props → JSX. No client JS.
 */
export function DensityChart({
  density,
  bucketMin,
  dayParam,
  fine,
  windowStart,
  windowEnd,
}: DensityChartProps) {
  const bucketToggle = (
    <div className="flex gap-1" role="group" aria-label="Veličina vremenskog intervala">
      <Link
        href={`/?day=${dayParam}`}
        aria-pressed={!fine}
        aria-label="15-minutni intervali"
        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          !fine ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'
        }`}
      >
        15 min
      </Link>
      <Link
        href={`/?day=${dayParam}&fine=1`}
        aria-pressed={fine}
        aria-label="5-minutni intervali"
        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          fine ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'
        }`}
      >
        5 min
      </Link>
    </div>
  );

  // Empty state — no reservations on this day
  if (windowStart === null || density.length === 0) {
    return (
      <section
        className="rounded-2xl bg-card border border-border p-4 shadow-card-md"
        aria-label="Gustoća rezervacija"
      >
        <div className="flex items-center justify-between mb-3 gap-2">
          <h2 className="text-sm font-bold text-foreground uppercase tracking-widest">Gustoća</h2>
          {bucketToggle}
        </div>
        <p className="text-sm text-muted-foreground text-center py-8">
          Nema rezervacija — nema gustoće za prikaz
        </p>
      </section>
    );
  }

  const barWidthPct = 100 / density.length;
  const windowStartMs = windowStart.getTime();
  const windowEndMs = windowEnd?.getTime() ?? windowStartMs;

  return (
    <section
      className="rounded-2xl bg-card border border-border p-4 shadow-card-md"
      aria-label="Gustoća rezervacija po vremenskim terminima"
    >
      {/* Header: title + bucket-size toggle */}
      <div className="flex items-center justify-between mb-3 gap-2">
        <h2 className="text-sm font-bold text-foreground uppercase tracking-widest">Gustoća</h2>
        {bucketToggle}
      </div>

      <div className="relative">
        {/* Fleet ceiling label */}
        <div className="flex items-center gap-1 mb-1">
          <span className="text-xs text-muted-foreground font-mono tabular-nums w-5 text-right">
            {FLEET}
          </span>
          <div className="flex-1 border-t border-dashed border-border" aria-hidden="true" />
        </div>

        {/* Bar chart — scroll wrapper contains bar zone (h-20) + label zone (h-6).
            overflow-x-auto on this wrapper co-scrolls bars and labels together.
            The bar-height math (totalPct) is anchored to the inner h-20 bar zone,
            not the outer wrapper, so FLEET baseline is unaffected. */}
        <div
          className="overflow-x-auto"
          role="img"
          aria-label={`Gustoća rezervacija: ${density.length} vremenskih intervala od ${bucketMin} minuta`}
        >
          {/* Inner flex row: each column is bar zone (h-20) + label zone (h-6) stacked */}
          <div className="flex items-end gap-px">
            {density.map((bucket) => {
              const reservedClamped = Math.min(bucket.reservedCount, FLEET);
              const maintenanceClamped = Math.min(bucket.maintenanceCount, FLEET - reservedClamped);
              const totalClamped = reservedClamped + maintenanceClamped;
              const reservedPct = (reservedClamped / FLEET) * 100;
              const maintenancePct = (maintenanceClamped / FLEET) * 100;
              const totalPct = reservedPct + maintenancePct;

              // Hour boundary: label shown only within [windowStart, windowEnd]
              const bucketMs = bucket.start.getTime();
              const minuteOfBucket = parseInt(
                bucket.start.toLocaleTimeString('hr-HR', {
                  timeZone: 'Europe/Zagreb',
                  minute: '2-digit',
                }),
                10,
              );
              const isHourBoundary = minuteOfBucket === 0;
              const isInWindow = bucketMs >= windowStartMs && bucketMs <= windowEndMs;
              const showLabel = isHourBoundary && isInWindow;

              const bucketLabel = bucket.start.toLocaleTimeString('hr-HR', {
                timeZone: 'Europe/Zagreb',
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                /* Column wrapper: flex column, bar zone on top, label zone on bottom.
                   No overflow — both zones live inside the scrollable parent. */
                <div
                  key={bucket.start.toISOString()}
                  className="flex flex-col shrink-0"
                  style={{ width: `${barWidthPct}%`, minWidth: '4px' }}
                  title={`${bucketLabel}: ${bucket.reservedCount} rezerv. + ${bucket.maintenanceCount} nedost.`}
                  aria-label={`${bucketLabel}: ${bucket.reservedCount + bucket.maintenanceCount} od ${FLEET} skutera zauzeto`}
                >
                  {/* Bar zone — fixed 80px; height math anchored here */}
                  <div className="flex flex-col justify-end h-20">
                    {totalClamped === 0 ? (
                      /* Empty bar — tiny baseline marker */
                      <div className="w-full bg-muted/30 rounded-sm" style={{ height: '2px' }} />
                    ) : (
                      <div className="w-full rounded-sm" style={{ height: `${totalPct}%` }}>
                        {maintenancePct > 0 && (
                          <div
                            className="w-full bg-warning rounded-t-sm"
                            style={{ height: `${(maintenancePct / totalPct) * 100}%` }}
                          />
                        )}
                        {reservedPct > 0 && (
                          <div
                            className="w-full bg-primary"
                            style={{
                              height: `${(reservedPct / totalPct) * 100}%`,
                              borderRadius: maintenancePct > 0 ? '0' : '2px 2px 0 0',
                            }}
                          />
                        )}
                      </div>
                    )}
                  </div>

                  {/* Label zone — fixed 24px; always present for layout stability */}
                  <div className="h-6 flex items-start justify-center pt-0.5">
                    {showLabel && (
                      <span
                        className="text-xs font-mono text-muted-foreground tabular-nums whitespace-nowrap"
                        aria-hidden="true"
                      >
                        {bucketLabel}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2" aria-label="Legenda grafikona">
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-sm bg-primary" aria-hidden="true" />
          <span className="text-xs text-muted-foreground">Rezervirano</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-sm bg-warning" aria-hidden="true" />
          <span className="text-xs text-muted-foreground">Nedostupno</span>
        </div>
      </div>
    </section>
  );
}
