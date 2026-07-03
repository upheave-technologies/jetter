import { TrendingUp, Users, Clock, Zap } from 'lucide-react';
import type { UtilizationReport } from '@/modules/bookings/domain/types';
import { formatHHMM } from '@/lib/time';

// Fleet baseline — 8 scooters, named constant per SPEC.
const FLEET = 8;

type UtilizationPanelProps = {
  utilization: UtilizationReport;
  windowStart: Date | null;
  windowEnd: Date | null;
};

/**
 * Daily utilization review panel (DEC-P7).
 *
 * Shows: utilizationPct%, peakConcurrent, busiestHourStart, reservationCount,
 * and idle scooter-hours (converting idleScooterMinutes → hours).
 *
 * Period label shown in heading when windowStart + windowEnd are present.
 * Empty state shown when reservationCount === 0.
 *
 * Server component — pure props → JSX.
 */
export function UtilizationPanel({ utilization, windowStart, windowEnd }: UtilizationPanelProps) {
  const {
    utilizationPct,
    peakConcurrent,
    busiestHourStart,
    reservationCount,
    idleScooterMinutes,
  } = utilization;

  const utilizationRounded = Math.round(utilizationPct);
  const idleHours = (idleScooterMinutes / 60).toFixed(1);
  const busiestHourLabel = busiestHourStart ? formatHHMM(busiestHourStart) : null;

  const periodLabel =
    windowStart && windowEnd
      ? `za period ${formatHHMM(windowStart)}–${formatHHMM(windowEnd)}`
      : null;

  // Colour-code utilization: high ≥ 70%, medium 40–69%, low < 40%
  const utilizationColor =
    utilizationRounded >= 70
      ? 'text-success'
      : utilizationRounded >= 40
        ? 'text-warning'
        : 'text-destructive';

  return (
    <section
      className="rounded-2xl bg-card border border-border p-4 shadow-card-md"
      aria-label="Dnevni pregled iskorištenosti"
    >
      <h2 className="text-sm font-bold text-foreground uppercase tracking-widest mb-4 flex items-center gap-2">
        <TrendingUp className="h-4 w-4" aria-hidden="true" />
        Iskorištenost{' '}
        {periodLabel && (
          <span className="font-normal normal-case text-muted-foreground">{periodLabel}</span>
        )}
      </h2>

      {/* Hero: utilization % large display */}
      <div className="flex items-baseline gap-1 mb-4">
        <span
          className={`font-extrabold tabular-nums text-board-xl ${utilizationColor}`}
          aria-label={`Iskorištenost: ${utilizationRounded}%`}
        >
          {utilizationRounded}
        </span>
        <span className={`font-bold text-board-lg ${utilizationColor}`}>%</span>
      </div>

      {reservationCount === 0 && (
        <p className="text-sm text-muted-foreground mb-4">Nema rezervacija za ovaj dan.</p>
      )}

      {/* Metrics grid */}
      <dl className="grid grid-cols-2 gap-3">
        <MetricCard
          icon={<Users className="h-4 w-4" aria-hidden="true" />}
          label="Najveći broj istovremeno"
          value={`${peakConcurrent}/${FLEET}`}
        />
        <MetricCard
          icon={<Zap className="h-4 w-4" aria-hidden="true" />}
          label="Rezervacija"
          value={String(reservationCount)}
        />
        {busiestHourLabel && (
          <MetricCard
            icon={<Clock className="h-4 w-4" aria-hidden="true" />}
            label="Najprometniji sat"
            value={busiestHourLabel}
          />
        )}
        <MetricCard
          icon={<TrendingUp className="h-4 w-4 rotate-180 text-muted-foreground" aria-hidden="true" />}
          label="Neiskorišteno"
          value={`${idleHours} skuter-h`}
          muted
        />
      </dl>
    </section>
  );
}

// ---------------------------------------------------------------------------
// MetricCard — individual metric cell.
// ---------------------------------------------------------------------------

type MetricCardProps = {
  icon: React.ReactNode;
  label: string;
  value: string;
  muted?: boolean;
};

function MetricCard({ icon, label, value, muted = false }: MetricCardProps) {
  return (
    <div className="rounded-xl bg-muted/40 px-3 py-3">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground font-semibold mb-1.5">
        <span className="text-muted-foreground">{icon}</span>
        {label}
      </dt>
      <dd
        className={`font-bold tabular-nums text-board leading-none ${
          muted ? 'text-muted-foreground' : 'text-foreground'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
