// =============================================================================
// Bookings Module — Booking Domain Predicates
// =============================================================================
// Pure functions expressing domain rules about a single Booking.
// No I/O, no Date.now(). `now` is always passed in.
// =============================================================================

import type { Booking } from './types';

/**
 * Returns true if the booking can be cancelled given the current time.
 *
 * Why: DEC-P2 — past/in-progress reservations are immutable; maintenance
 * blocks can be cancelled any time they haven't ended.
 *
 * Rules:
 *   reservation → cancellable only if startTime > now (strictly in the future)
 *   maintenance → cancellable any time end > now (hasn't ended yet)
 *
 * This pure function lives in domain/ so the use case shell can call it
 * without embedding policy inline (donnie-rules §6.1).
 */
/**
 * Returns true if the maintenance block can be edited given the current time.
 *
 * Why: DEC-EM2 — a maintenance block is editable while it has not fully ended
 * and is not cancelled. Editing a still-running block is legitimate (reduce the
 * count as scooters return, extend the repair time). Only fully-ended or
 * cancelled blocks are immutable.
 *
 * Rules:
 *   - booking.kind must be 'maintenance'
 *   - booking.status must not be 'cancelled'
 *   - booking.endTime must be strictly after now (hasn't fully ended yet)
 *
 * This pure predicate lives in domain/ so the use case shell calls it without
 * embedding policy inline (donnie-rules §6.1). `now` is always passed in —
 * no Date.now() inside domain functions (donnie-rules §1).
 */
export function canEditMaintenance(booking: Booking, now: Date): boolean {
  if (booking.kind !== 'maintenance') return false;
  if (booking.status === 'cancelled') return false;
  return booking.endTime.getTime() > now.getTime();
}

export function canCancel(booking: Booking, now: Date): boolean {
  if (booking.status === 'cancelled') return false;
  if (booking.kind === 'reservation') {
    return booking.startTime.getTime() > now.getTime();
  }
  // maintenance
  return booking.endTime.getTime() > now.getTime();
}
