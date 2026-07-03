import { CalendarCheck2, Wrench } from 'lucide-react';
import type { DayBoard, Booking } from '@/modules/bookings/domain/types';
import { BookingRow } from '@/app/_components/BookingRow/BookingRow';
import { ShowPastContainer } from '@/app/_containers/ShowPastContainer/ShowPastContainer';
import { classifyTemporal } from '@/app/_components/TemporalBadge/TemporalBadge';

type BookingsListProps = {
  reservations: DayBoard['reservations'];
  maintenance: DayBoard['maintenance'];
  now: Date;
  /**
   * True when the selected day is today. Controls whether the past-collapse
   * toggle is shown (DEC-TF1, AC-4).
   * On non-today days the full list renders with no toggle — exactly as before.
   */
  isToday: boolean;
};

/**
 * Two-section booking list for the reservation-pivot board (DEC-P1..DEC-P2).
 *
 * "Rezervacije" — non-cancelled reservations, sorted by startTime ASC.
 *   PENDING rows have Uredi + Otkaži actions. CURRENT/PAST rows are read-only.
 *
 *   On today (isToday=true, DEC-TF1):
 *     - CURRENT + PENDING rows are shown by default (relevant reservations).
 *     - PAST rows are collapsed behind a show/hide toggle with a count (AC-1).
 *     - If zero current+pending but there ARE past rows, still show the toggle
 *       so the operator can reach them; empty-state copy reflects "nothing
 *       relevant right now."
 *
 *   On non-today days (isToday=false, DEC-TF1, AC-4):
 *     - All rows render with no toggle — unchanged from pre-feature behavior.
 *
 * "Nedostupnost" — maintenance blocks, sorted by startTime ASC.
 *   Same three-state temporal reading for honest labeling (DEC-TF5).
 *   No separate collapse section — maintenance volume is low (DEC-TF5).
 *
 * No "Vani" / "Najavljeno" / "Povijest" sections (DEC-P1 — old lifecycle removed).
 * Cancelled rows are filtered upstream (getDayBoard returns only non-cancelled).
 *
 * Server component — pure props → JSX.
 */
export function BookingsList({ reservations, maintenance, now, isToday }: BookingsListProps) {
  // ---------------------------------------------------------------------------
  // Temporal split for the REZERVACIJE section (DEC-TF1, DEC-TF2)
  // All classification uses server `now` — no Date.now() (AC-5).
  // ---------------------------------------------------------------------------
  const relevantReservations: Booking[] = [];
  const pastReservations: Booking[] = [];

  for (const booking of reservations) {
    const state = classifyTemporal(booking.startTime, booking.endTime, now);
    if (isToday && state === 'past') {
      pastReservations.push(booking);
    } else {
      relevantReservations.push(booking);
    }
  }

  // On non-today days: all reservations are "relevant" (no split), no toggle.
  // On today: relevant = current + pending; past = collapsed behind toggle.

  return (
    <div className="flex flex-col gap-6">
      {/* ---------------------------------------------------------------- */}
      {/* REZERVACIJE section                                               */}
      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="section-reservations">
        <h2
          id="section-reservations"
          className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground"
        >
          Rezervacije
        </h2>

        {relevantReservations.length === 0 && pastReservations.length === 0 ? (
          /* Truly empty day — no reservations at all */
          <EmptyState
            icon="calendar"
            message="Nema rezervacija"
            sub="Dodaj prvu rezervaciju ispod."
          />
        ) : relevantReservations.length === 0 && isToday ? (
          /* Today, all reservations are past — show friendly copy + toggle */
          <>
            <EmptyState
              icon="calendar"
              message="Nema aktivnih rezervacija"
              sub="Sve rezervacije za danas su završile."
            />
            <ShowPastContainer count={pastReservations.length}>
              <PastReservationList bookings={pastReservations} now={now} />
            </ShowPastContainer>
          </>
        ) : (
          /* Relevant (current + pending) rows visible */
          <>
            <ol className="flex flex-col gap-3" aria-label="Rezervacije za ovaj dan">
              {relevantReservations.map((booking: Booking) => (
                <li key={booking.id}>
                  <BookingRow booking={booking} now={now} />
                </li>
              ))}
            </ol>

            {/* Collapsed past rows — today only (DEC-TF1, AC-1) */}
            {isToday && pastReservations.length > 0 && (
              <ShowPastContainer count={pastReservations.length}>
                <PastReservationList bookings={pastReservations} now={now} />
              </ShowPastContainer>
            )}
          </>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* NEDOSTUPNOST section — maintenance blocks (DEC-P3, DEC-TF5)     */}
      {/* Same three-state temporal reading; no separate collapse (DEC-TF5)*/}
      {/* ---------------------------------------------------------------- */}
      {maintenance.length > 0 && (
        <section aria-labelledby="section-maintenance">
          <h2
            id="section-maintenance"
            className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground"
          >
            Nedostupnost / kvar
          </h2>

          <ol className="flex flex-col gap-3" aria-label="Blokade skutera za ovaj dan">
            {maintenance.map((booking: Booking) => (
              <li key={booking.id}>
                <BookingRow booking={booking} now={now} />
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PastReservationList — server-rendered list of past booking rows, passed as
// children to ShowPastContainer so they stay server components (AC-7).
// ---------------------------------------------------------------------------

function PastReservationList({ bookings, now }: { bookings: Booking[]; now: Date }) {
  return (
    <ol className="flex flex-col gap-3" aria-label="Protekle rezervacije">
      {bookings.map((booking: Booking) => (
        <li key={booking.id}>
          <BookingRow booking={booking} now={now} />
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// EmptyState — muted placeholder for empty sections.
// ---------------------------------------------------------------------------

type EmptyStateProps = {
  icon: 'calendar' | 'wrench';
  message: string;
  sub?: string;
};

function EmptyState({ icon, message, sub }: EmptyStateProps) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card px-5 py-7 text-center">
      <span className="inline-block mb-2 opacity-30" aria-hidden="true">
        {icon === 'calendar' ? (
          <CalendarCheck2 className="h-8 w-8" aria-hidden="true" />
        ) : (
          <Wrench className="h-8 w-8" aria-hidden="true" />
        )}
      </span>
      <p className="text-muted-foreground font-semibold text-sm">{message}</p>
      {sub && (
        <p className="text-muted-foreground text-xs mt-1 opacity-75">{sub}</p>
      )}
    </div>
  );
}
