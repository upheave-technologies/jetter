/**
 * TemporalBadge — small badge that communicates a booking's temporal state
 * to the operator at a glance.
 *
 * Three states (DEC-TF2, DEC-TF4, AC-2):
 *   CURRENT  — in progress right now (`startTime <= now < endTime`)
 *              → success token (green), pulsing dot, Croatian "U TIJEKU"
 *   PENDING  — upcoming, not yet started (`startTime > now`)
 *              → primary/neutral tint, Croatian "USKORO"
 *   PAST     — window has fully ended (`endTime <= now`)
 *              → no badge; the row label carries this meaning inline
 *
 * Design-system constraints (frankie-rules §2.1, DEC-TF4):
 *   - Semantic tokens only — no hardcoded colours.
 *   - No arbitrary Tailwind values.
 *
 * Server component — pure props → JSX.
 */

export type TemporalState = 'current' | 'pending' | 'past';

type TemporalBadgeProps = {
  state: TemporalState;
};

export function TemporalBadge({ state }: TemporalBadgeProps) {
  if (state === 'past') {
    // Past rows carry their label inline in the row body; no badge needed.
    return null;
  }

  if (state === 'current') {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-success px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-success-foreground"
        aria-label="Rezervacija u tijeku"
      >
        {/* Pulsing dot — communicates "live" without a client component */}
        <span
          className="block h-1.5 w-1.5 rounded-full bg-success-foreground animate-pulse shrink-0"
          aria-hidden="true"
        />
        U tijeku
      </span>
    );
  }

  // pending
  return (
    <span
      className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-primary"
      aria-label="Nadolazeća rezervacija"
    >
      Uskoro
    </span>
  );
}

// ---------------------------------------------------------------------------
// Utility — classify a booking against server now into a TemporalState.
// Used by BookingRow and BookingsList (server components; no clock reads).
// All inputs are server-authoritative — no Date.now() anywhere (AC-5, DEC-TF2).
// ---------------------------------------------------------------------------

/**
 * Classifies a booking window against the server's `now`.
 *
 * PAST    : endTime <= now        (window fully ended)
 * CURRENT : startTime <= now < endTime   (in progress — half-open [start, end))
 * PENDING : startTime > now       (not yet started)
 *
 * Mirrors R-AVAIL-3 semantics: a reservation whose window ends exactly at `now`
 * is PAST; one whose window starts exactly at `now` is CURRENT.
 */
export function classifyTemporal(
  startTime: Date,
  endTime: Date,
  now: Date,
): TemporalState {
  if (endTime <= now) return 'past';
  if (startTime <= now) return 'current';
  return 'pending';
}
