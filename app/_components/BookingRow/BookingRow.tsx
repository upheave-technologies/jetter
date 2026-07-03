import { Wrench, X } from 'lucide-react';
import type { Booking, BookingId } from '@/modules/bookings/domain/types';
import { cancelBookingAction } from '@/app/actions';
import { StatusPill } from '@/app/_components/StatusPill/StatusPill';
import { TemporalBadge, classifyTemporal } from '@/app/_components/TemporalBadge/TemporalBadge';
import { ConfirmButton } from '@/app/_containers/ConfirmButton/ConfirmButton';
import { BookingEditContainer } from '@/app/_containers/BookingEditContainer/BookingEditContainer';
import { MaintenanceEditContainer } from '@/app/_containers/MaintenanceEditContainer/MaintenanceEditContainer';
import { formatHHMM } from '@/lib/time';

type BookingRowProps = {
  booking: Booking;
  /** Server "now" — used for temporal classification and action-bar gating (DEC-P2, DEC-TF2). */
  now: Date;
};

/**
 * Card-style row for a single booking (reservation or maintenance block).
 *
 * Visual hierarchy:
 *   - Left accent stripe: primary for reservations, warning for maintenance.
 *   - Main content: quantity + time window, renter name (reservations only), notes.
 *   - Right badge: StatusPill (kind × status) + TemporalBadge (current/pending).
 *   - Action bar: PENDING-only edit/cancel (DEC-P2, DEC-TF2).
 *
 * Three temporal states (DEC-TF2, AC-2, AC-3, AC-6):
 *   PAST    (endTime <= now)              — read-only, muted label.
 *   CURRENT (startTime <= now < endTime)  — read-only, "U tijeku" success badge.
 *   PENDING (startTime > now)             — action bar visible.
 *
 * Action bar gating: action bar shows ONLY for PENDING rows (DEC-P2).
 * CURRENT and PAST rows are always read-only (no action bar).
 *
 * Maintenance blocks: same three-state reading for honest labeling (DEC-TF5).
 * No separate collapse for maintenance (DEC-TF5 — maintenance volume is low).
 *
 * Server component — pure props → JSX.
 */
export function BookingRow({ booking, now }: BookingRowProps) {
  // Three-state temporal classification against server now (DEC-TF2, AC-5).
  // Never reads Date.now() — `now` is always board.now from the server.
  const temporalState = classifyTemporal(booking.startTime, booking.endTime, now);
  const isPending = temporalState === 'pending';
  const isMaintenance = booking.kind === 'maintenance';

  // DEC-EM2: maintenance is editable while endTime > now and not cancelled.
  // This includes CURRENT (running) blocks — a repair in progress is exactly
  // the moment you adjust it. Mirrors canEditMaintenance(booking, now).
  const isMaintenanceEditable =
    isMaintenance &&
    booking.status !== 'cancelled' &&
    booking.endTime > now;

  const accentStripe = isMaintenance
    ? 'border-l-4 border-l-warning'
    : 'border-l-4 border-l-primary';

  const startTimeStr = formatHHMM(booking.startTime);
  const endTimeStr = formatHHMM(booking.endTime);

  // Confirmation modal summary line
  const confirmBody = [
    booking.renterName,
    `${booking.quantity} skuter${booking.quantity !== 1 ? 'a' : ''}`,
    `${startTimeStr}–${endTimeStr}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <article
      className={`booking-card ${accentStripe}`}
      aria-label={
        isMaintenance
          ? `Nedostupnost: ${booking.quantity} skutera, ${startTimeStr}–${endTimeStr}`
          : `Rezervacija: ${booking.quantity} skutera, ${startTimeStr}–${endTimeStr}`
      }
    >
      {/* ---------------------------------------------------------------- */}
      {/* Main booking info                                                 */}
      {/* ---------------------------------------------------------------- */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          {/* Left: icon (maintenance) + quantity + time */}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              {isMaintenance && (
                <Wrench
                  className="h-[15px] w-[15px] text-warning self-center shrink-0"
                  aria-hidden="true"
                />
              )}
              <span
                className="text-foreground font-extrabold text-board-lg leading-none tabular-nums"
                aria-label={`${booking.quantity} skutera`}
              >
                {booking.quantity}
              </span>
              <span className="text-muted-foreground font-medium text-sm">
                {isMaintenance ? 'nedostupnih' : `skuter${booking.quantity !== 1 ? 'a' : ''}`}
              </span>
              <span className="text-foreground font-bold text-board tabular-nums">
                {startTimeStr}–{endTimeStr}
              </span>
              <span className="text-muted-foreground text-xs">
                ({booking.durationMin} min)
              </span>
            </div>

            {/* Renter name — only for reservations */}
            {!isMaintenance && booking.renterName && (
              <p className="mt-1.5 text-foreground font-semibold truncate">
                {booking.renterName}
              </p>
            )}

            {/* Notes */}
            {booking.notes && (
              <p className="mt-0.5 text-muted-foreground text-sm line-clamp-2">
                {booking.notes}
              </p>
            )}

            {/* Past label — only shown for genuinely past rows (AC-3, DEC-TF5).
                CURRENT rows never read "in the past" — they get the TemporalBadge above.
                The mislabel bug (isFuture binary split) is fixed by the three-state
                classifyTemporal above (DEC-TF2). */}
            {temporalState === 'past' && (
              <p className="mt-1 text-xs text-muted-foreground italic">
                {isMaintenance ? 'Blokada završena' : 'Rezervacija u prošlosti'}
              </p>
            )}
            {temporalState === 'current' && isMaintenance && (
              <p className="mt-1 text-xs text-muted-foreground italic">
                Blokada u tijeku
              </p>
            )}
          </div>

          {/* Right: status pill + temporal badge */}
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <StatusPill status={booking.status} kind={booking.kind} />
            <TemporalBadge state={temporalState} />
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Action bar gating (DEC-P2, DEC-TF2, DEC-EM2):                 */}
      {/*   Reservations — PENDING only (startTime > now).              */}
      {/*   Maintenance  — while endTime > now and not cancelled.       */}
      {/*                  Includes CURRENT (running) blocks per DEC-EM2 */}
      {/*                  ("a repair in progress is exactly the moment  */}
      {/*                   you adjust it").                             */}
      {/* ---------------------------------------------------------------- */}
      {(isPending || isMaintenanceEditable) && (
        <ActionBar
          booking={booking}
          confirmBody={confirmBody}
          now={now}
        />
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// ActionBar — shown only for future bookings. No send-out / return / extend
// affordances (DEC-P1). Maintenance rows: cancel only. Reservations: edit + cancel.
// ---------------------------------------------------------------------------

type ActionBarProps = {
  booking: Booking;
  confirmBody: string;
  now: Date;
};

function ActionBar({ booking, confirmBody, now }: ActionBarProps) {
  const isMaintenance = booking.kind === 'maintenance';

  return (
    <div
      className="flex flex-wrap gap-2 px-4 pb-4 pt-0"
      role="group"
      aria-label="Akcije rezervacije"
    >
      {/* Edit panel — reservations use BookingEditContainer (with availability
          verdict); maintenance uses MaintenanceEditContainer (no fits() check,
          DEC-EM1/DEC-P3). Gate: reservations = isPending (future-only);
          maintenance = isMaintenanceEditable (endTime > now, DEC-EM2). Both
          conditions are enforced by the caller (BookingRow) before rendering
          ActionBar — see the outer guard. */}
      {!isMaintenance && (
        <BookingEditContainer booking={booking} now={now} />
      )}
      {isMaintenance && (
        <MaintenanceEditContainer booking={booking} now={now} />
      )}

      {/* Cancel — both reservation and maintenance */}
      <CancelForm id={booking.id} confirmBody={confirmBody} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// CancelForm — ConfirmButton wrapping cancelBookingAction.
// The single cast from Promise<ActionResult> to Promise<void> lives here.
// ---------------------------------------------------------------------------

type ServerAction = (formData: FormData) => Promise<void>;

function CancelForm({
  id,
  confirmBody,
}: {
  id: BookingId;
  confirmBody: string;
}) {
  return (
    <form action={cancelBookingAction as unknown as ServerAction}>
      <input type="hidden" name="id" value={id} />
      <ConfirmButton
        title="Otkaži rezervaciju?"
        body={confirmBody}
        confirmLabel="Da, otkaži"
        cancelLabel="Ne, zadrži"
        destructive
        className="action-btn bg-muted text-destructive hover:bg-destructive/10"
      >
        <X className="h-[15px] w-[15px]" aria-hidden="true" />
        Otkaži
      </ConfirmButton>
    </form>
  );
}
