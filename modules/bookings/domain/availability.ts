// =============================================================================
// Bookings Module — Availability Pure Functions
// =============================================================================
// The sacred core (DEC-P9 / DEC-A). Single source of truth for ALL fit math.
// ALL functions are pure over plain values — no I/O, no side effects, no
// Date.now() calls. Parameters for now/fleet/operating-window are always
// passed in.
//
// Business rules implemented here:
//   R-AVAIL-1  capacity ceiling
//   R-AVAIL-2  fit = peak commitment by others + Q ≤ FLEET_SIZE
//   R-AVAIL-3  boundary handoff: [start, end) — end is exclusive
//   R-AVAIL-4  next opening scan (delegated to openSlots — DEC-P5)
//   DEC-P3     both reservation AND maintenance kinds count in commitments
//   DEC-P4     density profile
//   DEC-P5     openSlots generalizes nextOpening
//   DEC-P6     reconcile — greedy, proposal-only
//   DEC-P7     utilizationReport
//   DEC-P9     no fit/density/slot/reconciliation math elsewhere
// =============================================================================

import type {
  Booking,
  BookingId,
  DensityBucket,
  Disruption,
  ReconciliationChange,
  ReconciliationProposal,
  UtilizationReport,
} from './types';
import { FLEET_SIZE, SLOT_GRANULARITY_MIN } from './config';

// ---------------------------------------------------------------------------
// Helpers (file-private)
// ---------------------------------------------------------------------------

/**
 * Overlap in minutes between two half-open intervals [aStart, aEnd) and [bStart, bEnd).
 * Returns 0 when there is no overlap.
 */
function overlapMinutes(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const overlapStart = Math.max(aStart.getTime(), bStart.getTime());
  const overlapEnd = Math.min(aEnd.getTime(), bEnd.getTime());
  return Math.max(0, (overlapEnd - overlapStart) / 60_000);
}

// ---------------------------------------------------------------------------
// Commitment counting
// ---------------------------------------------------------------------------

/**
 * Returns the number of scooters committed at instant `t`.
 *
 * Why: availability at any point requires knowing how many scooters are already
 * spoken for. Both reservation AND maintenance records count (DEC-P3) — one
 * unified timeline. Cancelled records contribute nothing.
 *
 * The window is [start, end) — right-edge exclusive — per R-AVAIL-3.
 * This implements the boundary-handoff rule: a booking ending at T does NOT
 * conflict with one starting at T.
 */
export function commitmentAt(records: Booking[], t: Date): number {
  let total = 0;
  for (const b of records) {
    if (b.status === 'cancelled') continue;
    // [start, end) — t must satisfy start ≤ t < end
    if (b.startTime <= t && t < b.endTime) {
      total += b.quantity;
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// Peak commitment over a window
// ---------------------------------------------------------------------------

/**
 * Returns the peak (maximum) number of scooters committed by `records` at any
 * instant within [windowStart, windowEnd).
 *
 * Why: R-AVAIL-2 requires that peak commitment plus Q ≤ FLEET_SIZE.
 * Checking only at a single point would miss overlapping records that kick in
 * partway through the proposed window.
 *
 * Implementation: O(n log n) boundary-scan. Commitment is constant between
 * consecutive boundaries — evaluate at each boundary and take the max.
 * Always includes windowStart as the first probe point.
 */
export function peakCommitment(
  records: Booking[],
  windowStart: Date,
  windowEnd: Date,
): number {
  const boundaryMs = new Set<number>([windowStart.getTime()]);

  for (const b of records) {
    if (b.status === 'cancelled') continue;
    const startMs = b.startTime.getTime();
    const endMs = b.endTime.getTime();
    const wStartMs = windowStart.getTime();
    const wEndMs = windowEnd.getTime();

    if (startMs > wStartMs && startMs < wEndMs) boundaryMs.add(startMs);
    if (endMs > wStartMs && endMs < wEndMs) boundaryMs.add(endMs);
  }

  let peak = 0;
  for (const ms of boundaryMs) {
    const c = commitmentAt(records, new Date(ms));
    if (c > peak) peak = c;
  }
  return peak;
}

// ---------------------------------------------------------------------------
// Fit check
// ---------------------------------------------------------------------------

/**
 * Returns true if a booking for `quantity` scooters over [start, end) would
 * fit given the existing `records`.
 *
 * Why: R-AVAIL-2 — peak commitment by others plus Q must not exceed the fleet
 * ceiling. Both kinds count (DEC-P3). Cancelled records are excluded.
 *
 * The optional `fleet` parameter lets callers (e.g. `reconcile`) test fit
 * against a custom ceiling (capacity_drop lowers effective fleet) without
 * duplicating the boundary-scan logic (DEC-A / architecture §9).
 * Defaults to FLEET_SIZE so all existing call sites are unchanged.
 */
export function fits(
  records: Booking[],
  quantity: number,
  start: Date,
  end: Date,
  fleet: number = FLEET_SIZE,
): boolean {
  return peakCommitment(records, start, end) + quantity <= fleet;
}

// ---------------------------------------------------------------------------
// Free now
// ---------------------------------------------------------------------------

/**
 * Returns the number of scooters available at `now`.
 *
 * Why: the Board always shows how many scooters are free right now.
 */
export function freeNow(records: Booking[], now: Date): number {
  return FLEET_SIZE - commitmentAt(records, now);
}

// ---------------------------------------------------------------------------
// Open slots
// ---------------------------------------------------------------------------

/**
 * Returns an ordered earliest-first list of feasible start times for `quantity`
 * scooters over `durationMin` minutes, at/after `fromTime`, ending by `dayEnd`,
 * capped at `maxResults`.
 *
 * Why: DEC-P5 — generalizes nextOpening into a list, powering the slot-finder
 * creation flow. Earliest-first ordering packs the day for utilization.
 *
 * Candidates: a uniform SLOT_GRANULARITY_MIN grid starting from `fromTime`
 * rounded UP to the next grid mark on the absolute epoch-ms axis.
 * `ceil(fromMs / step) * step` where step = SLOT_GRANULARITY_MIN * 60 000 ms.
 * This lands on wall-clock :00/:05/:10/…/:55 for Europe/Zagreb because the
 * zone offset is a whole number of minutes (R-AVAIL-6). A 12-hour window
 * produces ≤ 144 candidates; the loop breaks early once maxResults is reached.
 *
 * The optional `fleet` parameter lets callers (e.g. `reconcile`) test slots
 * against a custom ceiling without duplicating this scan (DEC-A / architecture §9).
 * Defaults to FLEET_SIZE so all existing call sites are unchanged.
 */
export function openSlots(
  records: Booking[],
  quantity: number,
  durationMin: number,
  fromTime: Date,
  dayEnd: Date,
  maxResults: number,
  fleet: number = FLEET_SIZE,
): Date[] {
  const durationMs = durationMin * 60_000;
  const latestStartMs = dayEnd.getTime() - durationMs;

  // Round fromTime UP to the next SLOT_GRANULARITY_MIN mark on the epoch-ms grid.
  const stepMs = SLOT_GRANULARITY_MIN * 60_000;
  const fromMs = fromTime.getTime();
  const firstCandidateMs = Math.ceil(fromMs / stepMs) * stepMs;

  if (firstCandidateMs > latestStartMs) return [];

  const result: Date[] = [];

  for (let startMs = firstCandidateMs; startMs <= latestStartMs; startMs += stepMs) {
    if (result.length >= maxResults) break;
    const start = new Date(startMs);
    const end = new Date(startMs + durationMs);
    if (fits(records, quantity, start, end, fleet)) {
      result.push(start);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Next opening (delegates to openSlots — DEC-A / DEC-P9)
// ---------------------------------------------------------------------------

/**
 * Returns the earliest start time at or after `fromTime` (and ending by
 * `dayEnd`) at which `quantity` scooters fit for `durationMin` minutes.
 * Returns null if no such slot exists.
 *
 * Why: R-AVAIL-4 — when a request doesn't fit, the Board shows the next
 * opening. Delegates to openSlots so the scan logic lives in one place
 * (DEC-A: no duplicated fit math).
 */
export function nextOpening(
  records: Booking[],
  quantity: number,
  durationMin: number,
  fromTime: Date,
  dayEnd: Date,
): Date | null {
  return openSlots(records, quantity, durationMin, fromTime, dayEnd, 1)[0] ?? null;
}

// ---------------------------------------------------------------------------
// Density profile (DEC-P4)
// ---------------------------------------------------------------------------

/**
 * Returns the density profile for a day as ordered buckets of committed-scooter
 * counts, split by kind. (DEC-P4)
 *
 * For each bucket [bStart, bStart+bucketMin) across [dayStart, dayEnd):
 *   reservedCount   = peak reservation commitment over the bucket
 *   maintenanceCount = peak maintenance commitment over the bucket
 *
 * Peak-over-bucket: a rental starting mid-bucket still shows in that bucket.
 * Cancelled records are excluded from both counts.
 */
export function densityProfile(
  records: Booking[],
  dayStart: Date,
  dayEnd: Date,
  bucketMin: number,
): DensityBucket[] {
  const buckets: DensityBucket[] = [];
  const bucketMs = bucketMin * 60_000;
  const reservations = records.filter(
    (b) => b.kind === 'reservation' && b.status !== 'cancelled',
  );
  const maintenance = records.filter(
    (b) => b.kind === 'maintenance' && b.status !== 'cancelled',
  );

  let cursor = dayStart.getTime();
  const end = dayEnd.getTime();

  while (cursor < end) {
    const bStart = new Date(cursor);
    const bEnd = new Date(cursor + bucketMs);
    buckets.push({
      start: bStart,
      reservedCount: peakCommitment(reservations, bStart, bEnd),
      maintenanceCount: peakCommitment(maintenance, bStart, bEnd),
    });
    cursor += bucketMs;
  }

  return buckets;
}

// ---------------------------------------------------------------------------
// Utilization report (DEC-P7)
// ---------------------------------------------------------------------------

/**
 * Returns a daily utilization report for the given records over the timeboxed
 * window [windowStart, windowEnd).
 *
 * utilizationPct = reservedScooterMinutes / max(1, capacityMinutes - maintenanceScooterMinutes) × 100
 * Clamped [0, 100], rounded to one decimal place.
 *
 * capacityMinutes = fleet × (windowEnd − windowStart in minutes).
 *
 * Maintenance reduces the capacity denominator (it's reality, not revenue).
 * Reservations fill the numerator. Record windows are clipped to [windowStart, windowEnd)
 * so a booking that extends outside the window only contributes the overlap.
 *
 * Pure: no Date.now() inside. All time instants passed in.
 */
export function utilizationReport(
  records: Booking[],
  windowStart: Date,
  windowEnd: Date,
  fleet: number,
): UtilizationReport {
  const opMinutes = (windowEnd.getTime() - windowStart.getTime()) / 60_000;
  const capacityMinutes = fleet * opMinutes;

  const reservations = records.filter(
    (b) => b.kind === 'reservation' && b.status !== 'cancelled',
  );
  const maintenanceRecs = records.filter(
    (b) => b.kind === 'maintenance' && b.status !== 'cancelled',
  );

  let reservedScooterMinutes = 0;
  for (const b of reservations) {
    reservedScooterMinutes +=
      b.quantity * overlapMinutes(b.startTime, b.endTime, windowStart, windowEnd);
  }

  let maintenanceScooterMinutes = 0;
  for (const b of maintenanceRecs) {
    maintenanceScooterMinutes +=
      b.quantity * overlapMinutes(b.startTime, b.endTime, windowStart, windowEnd);
  }

  const effectiveCap = Math.max(1, capacityMinutes - maintenanceScooterMinutes);
  const raw = (reservedScooterMinutes / effectiveCap) * 100;
  const utilizationPct = Math.min(100, Math.max(0, Math.round(raw * 10) / 10));
  const idleScooterMinutes = Math.max(
    0,
    capacityMinutes - maintenanceScooterMinutes - reservedScooterMinutes,
  );

  const peakConcurrent = peakCommitment(reservations, windowStart, windowEnd);

  // Busiest hour within the window: 1-hour bucket with the greatest reserved scooter-minutes
  let busiestHourStart: Date | null = null;
  let busiestHourMinutes = 0;
  let hourCursor = windowStart.getTime();
  const hourMs = 3_600_000;
  while (hourCursor < windowEnd.getTime()) {
    const hStart = new Date(hourCursor);
    const hEnd = new Date(hourCursor + hourMs);
    let hMinutes = 0;
    for (const b of reservations) {
      hMinutes += b.quantity * overlapMinutes(b.startTime, b.endTime, hStart, hEnd);
    }
    if (hMinutes > busiestHourMinutes) {
      busiestHourMinutes = hMinutes;
      busiestHourStart = hStart;
    }
    hourCursor += hourMs;
  }

  return {
    utilizationPct,
    reservedScooterMinutes,
    capacityMinutes,
    maintenanceScooterMinutes,
    idleScooterMinutes,
    peakConcurrent,
    busiestHourStart,
    reservationCount: reservations.length,
  };
}

// ---------------------------------------------------------------------------
// Reconciliation (DEC-P6)
// ---------------------------------------------------------------------------

/**
 * Returns the minimal proposal to restore a feasible running order after a
 * disruption. (DEC-P6) Pure, greedy, proposal-only — never auto-applied.
 *
 * Algorithm:
 *   1. Build disrupted timeline: for 'delay', extend target booking's end by
 *      extraMinutes; for 'capacity_drop', insert a virtual maintenance record.
 *   2. Find upcoming reservations (kind='reservation', status!='cancelled',
 *      start >= now), sorted by startTime ASC.
 *   3. For each infeasible reservation (earliest first):
 *      - Find earliest feasible new start via openSlots (with custom fleet)
 *        on the timeline excluding this reservation.
 *      - If found and later than current: record a ReconciliationChange;
 *        update the timeline with the shifted window.
 *      - If not found: add to unresolvable.
 *   4. Touch the FEWEST reservations; shift each by the LEAST delay.
 *
 * `now` and `fleet` are passed in — no Date.now() or FLEET_SIZE reads inside.
 */
export function reconcile(
  records: Booking[],
  disruption: Disruption,
  now: Date,
  fleet: number,
  dayEnd: Date,
): ReconciliationProposal {
  // Build a mutable timeline
  const timeline: Booking[] = [...records];

  // Apply the disruption
  if (disruption.type === 'delay') {
    const idx = timeline.findIndex(
      (b) => b.id === disruption.bookingId && b.status !== 'cancelled',
    );
    if (idx !== -1) {
      const b = timeline[idx];
      const newEnd = new Date(b.endTime.getTime() + disruption.extraMinutes * 60_000);
      timeline[idx] = { ...b, endTime: newEnd };
    }
  } else {
    // capacity_drop: add a virtual maintenance record
    const virtual: Booking = {
      id: '__virtual_disruption__' as BookingId,
      quantity: disruption.quantity,
      startTime: now,
      endTime: disruption.until,
      durationMin: Math.round((disruption.until.getTime() - now.getTime()) / 60_000),
      renterName: null,
      notes: null,
      status: 'reserved',
      kind: 'maintenance',
      createdAt: now,
      updatedAt: now,
    };
    timeline.push(virtual);
  }

  // Find upcoming reservations sorted by startTime.
  // For a 'delay' disruption the target booking is the CAUSE of the disruption —
  // it is already running (or just starting) and simply late. It stays put and
  // holds its scooters over the stretched window. We never propose moving it, so
  // it must be excluded from the candidate-to-shift set and can therefore never
  // appear in either `changes` or `unresolvable`.
  const disruptedId = disruption.type === 'delay' ? disruption.bookingId : null;

  const upcoming = timeline
    .filter(
      (b) =>
        b.kind === 'reservation' &&
        b.status !== 'cancelled' &&
        b.startTime.getTime() >= now.getTime() &&
        b.id !== disruptedId,
    )
    .sort((a, z) => a.startTime.getTime() - z.startTime.getTime());

  const changes: ReconciliationChange[] = [];
  const unresolvable: BookingId[] = [];

  for (const reservation of upcoming) {
    const others = timeline.filter((b) => b.id !== reservation.id);

    // Still fits — no change needed
    if (fits(others, reservation.quantity, reservation.startTime, reservation.endTime, fleet)) {
      continue;
    }

    // Doesn't fit — find earliest feasible new start
    const slots = openSlots(
      others,
      reservation.quantity,
      reservation.durationMin,
      reservation.startTime,
      dayEnd,
      1,
      fleet,
    );

    if (slots.length > 0 && slots[0].getTime() > reservation.startTime.getTime()) {
      const suggestedStart = slots[0];
      const delayMinutes = Math.round(
        (suggestedStart.getTime() - reservation.startTime.getTime()) / 60_000,
      );
      const changeRecord: ReconciliationChange = {
        bookingId: reservation.id,
        currentStart: reservation.startTime,
        suggestedStart,
        delayMinutes,
      };
      changes.push(changeRecord);

      // Update timeline with shifted window so downstream checks see it
      const idx = timeline.findIndex((b) => b.id === reservation.id);
      if (idx !== -1) {
        const b = timeline[idx];
        const newEnd = new Date(suggestedStart.getTime() + reservation.durationMin * 60_000);
        timeline[idx] = { ...b, startTime: suggestedStart, endTime: newEnd };
      }
    } else {
      unresolvable.push(reservation.id);
    }
  }

  return { changes, unresolvable };
}
