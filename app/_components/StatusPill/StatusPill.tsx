import type { BookingStatus, BookingKind } from '@/modules/bookings/domain/types';

type StatusPillProps = {
  status: BookingStatus;
  kind: BookingKind;
};

/**
 * Tiny presentational pill — shows whether a booking slot is a reservation or
 * a maintenance block. Colour-coded for sunlight legibility.
 *
 * kind='maintenance' → "Nedostupno" (warning token — capacity-blocking)
 * kind='reservation' → "Rezervirano" (muted/neutral — confirmed slot)
 * status='cancelled' → not rendered here (filtered upstream); exhaustive switch kept.
 *
 * Server component — pure props → JSX.
 */
export function StatusPill({ status, kind }: StatusPillProps) {
  const { label, cls } = resolveDisplay(status, kind);

  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-0.5 text-sm font-semibold leading-none ${cls}`}
    >
      {label}
    </span>
  );
}

function resolveDisplay(
  status: BookingStatus,
  kind: BookingKind,
): { label: string; cls: string } {
  // Cancelled rows are filtered upstream; keep the case exhaustive.
  if (status === 'cancelled') {
    return {
      label: 'Otkazano',
      cls: 'bg-muted text-muted-foreground',
    };
  }

  // Live reserved rows — discriminate by kind
  switch (kind) {
    case 'maintenance':
      return {
        label: 'Nedostupno',
        cls: 'bg-warning text-warning-foreground',
      };
    case 'reservation':
      return {
        label: 'Rezervirano',
        cls: 'bg-primary text-primary-foreground',
      };
  }
}
