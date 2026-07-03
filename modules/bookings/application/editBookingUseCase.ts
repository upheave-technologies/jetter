// =============================================================================
// Bookings Module — Edit Booking Use Case
// =============================================================================
// Edit a reservation's fields.
//
// DEC-P2: only strictly-future reservations are editable (IMMUTABLE_PAST).
// Moving start into the past is rejected (PAST_START).
// Availability re-checked excluding the record itself.
// Maintenance blocks are not editable via this use case.
//
// Concurrency: findByDay → fits() → update run atomically inside a Postgres
// transaction guarded by a per-day advisory lock (pg_advisory_xact_lock).
// A concurrent writer for the same day blocks on the lock, then re-reads
// inside its own transaction, re-runs fits(), and gets CAPACITY_EXCEEDED if
// capacity was filled by the winner — no silent overbooking possible.
// The initial findById (to load and validate the booking) runs outside the
// lock — it's a presence/editability check, not part of the capacity window.
//
// DEC-AU5/DEC-AU6: After a successful update, records an audit event via the
// injected AuditWriter port. Fail-open: audit failure logs CRITICAL but does
// NOT fail the user's action (the edit genuinely happened).
// The audit write is intentionally outside the advisory-lock transaction.
// =============================================================================

import type { Result } from '@/packages/shared/lib/result';
import { log } from '@/packages/shared/observability';
import type { Booking, EditBookingInput, BookingError } from '../domain/types';
import { fits } from '../domain/availability';
import { FLEET_SIZE, toLocalDayStart, toLocalDayEnd } from '../domain/config';
import type { IBookingRepository } from '../domain/repository';
import type { AuditWriter, AuditContext } from './ports/auditWriter';
import { bookingErr } from './bookingError';

const useCaseLog = log.child({ source: 'bookings.editBookingUseCase' });

export type EditBookingDeps = {
  bookingRepo: IBookingRepository;
  auditWriter: AuditWriter;
};

export const makeEditBookingUseCase = (deps: EditBookingDeps) => {
  return async (
    input: EditBookingInput & { context?: AuditContext },
  ): Promise<Result<Booking, BookingError>> => {
    const { bookingRepo, auditWriter } = deps;
    const now = new Date();

    useCaseLog.debug('booking.edit_started', { bookingId: input.id });

    // --- Input validation -------------------------------------------------

    if (
      input.quantity !== undefined &&
      (!Number.isInteger(input.quantity) ||
        input.quantity < 1 ||
        input.quantity > FLEET_SIZE)
    ) {
      return {
        success: false,
        error: bookingErr(
          'VALIDATION_ERROR',
          `Quantity must be between 1 and ${FLEET_SIZE}`,
        ),
      };
    }

    if (
      input.durationMin !== undefined &&
      (!Number.isInteger(input.durationMin) || input.durationMin < 1)
    ) {
      return {
        success: false,
        error: bookingErr(
          'VALIDATION_ERROR',
          'Duration must be a positive integer number of minutes',
        ),
      };
    }

    if (
      input.startTime !== undefined &&
      (!(input.startTime instanceof Date) || isNaN(input.startTime.getTime()))
    ) {
      return {
        success: false,
        error: bookingErr('VALIDATION_ERROR', 'Invalid start time'),
      };
    }

    // DEC-P2: reject moving start into the past
    if (input.startTime !== undefined && input.startTime.getTime() <= now.getTime()) {
      return {
        success: false,
        error: bookingErr('PAST_START', 'Start time must be in the future'),
      };
    }

    // --- Load -------------------------------------------------------------

    let booking: Booking | null;
    try {
      booking = await bookingRepo.findById(input.id);
    } catch (err) {
      useCaseLog.error(
        'booking.findById_failed',
        err instanceof Error ? err : new Error(String(err)),
        { bookingId: input.id },
      );
      return {
        success: false,
        error: bookingErr('SERVICE_ERROR', 'Failed to load booking'),
      };
    }

    if (booking === null) {
      return {
        success: false,
        error: bookingErr('NOT_FOUND', `Booking ${input.id} not found`),
      };
    }

    // Cancelled bookings cannot be edited
    if (booking.status === 'cancelled') {
      return {
        success: false,
        error: bookingErr(
          'IMMUTABLE_PAST',
          `Cannot edit a cancelled booking`,
        ),
      };
    }

    // DEC-P2: past/started reservations are immutable
    if (booking.startTime.getTime() <= now.getTime()) {
      return {
        success: false,
        error: bookingErr(
          'IMMUTABLE_PAST',
          `Cannot edit a reservation that has already started`,
        ),
      };
    }

    // Capture the before-snapshot for the audit record
    const bookingBefore: Booking = { ...booking };

    // --- Merge & recompute ------------------------------------------------

    const newQuantity = input.quantity ?? booking.quantity;
    const newStartTime = input.startTime ?? booking.startTime;
    const newDurationMin = input.durationMin ?? booking.durationMin;
    const newEndTime = new Date(
      newStartTime.getTime() + newDurationMin * 60_000,
    );

    if (newEndTime <= newStartTime) {
      return {
        success: false,
        error: bookingErr('VALIDATION_ERROR', 'End time must be after start time'),
      };
    }

    // --- Availability re-check + update (atomic under per-day advisory lock) ---
    // findByDay → fits() → update run inside a single transaction guarded by
    // pg_advisory_xact_lock(dayKey). A concurrent writer for the same day
    // blocks until the lock releases, then re-reads and re-evaluates fits()
    // against committed state — no silent overbooking possible.

    const day = toLocalDayStart(newStartTime);

    let updated: Booking;
    try {
      const lockResult = await bookingRepo.withDayLock(day, async (txRepo) => {
        const dayBookings = await txRepo.findByDay(
          toLocalDayStart(newStartTime),
          toLocalDayEnd(newStartTime),
        );

        // Exclude the current booking so we don't count it against itself
        const others = dayBookings.filter((b) => b.id !== booking!.id);

        if (!fits(others, newQuantity, newStartTime, newEndTime)) {
          return { ok: false as const };
        }

        const u: Booking = {
          ...booking!,
          quantity: newQuantity,
          startTime: newStartTime,
          durationMin: newDurationMin,
          endTime: newEndTime,
          renterName:
            input.renterName !== undefined ? input.renterName : booking!.renterName,
          notes: input.notes !== undefined ? input.notes : booking!.notes,
          updatedAt: now,
        };

        await txRepo.update(u);
        return { ok: true as const, updated: u };
      });

      if (!lockResult.ok) {
        return {
          success: false,
          error: bookingErr(
            'CAPACITY_EXCEEDED',
            'Edited reservation does not fit current availability',
          ),
        };
      }

      updated = lockResult.updated;
    } catch (err) {
      useCaseLog.error(
        'booking.update_failed',
        err instanceof Error ? err : new Error(String(err)),
        { bookingId: input.id },
      );
      return {
        success: false,
        error: bookingErr('SERVICE_ERROR', 'Failed to update booking'),
      };
    }

    useCaseLog.info('booking.edited', { bookingId: input.id });

    // --- Audit (DEC-AU5/DEC-AU6) -----------------------------------------
    try {
      await auditWriter.record({
        entityType: 'reservation',
        action: 'edit',
        entityId: updated.id,
        before: bookingBefore,
        after: updated,
        summary: 'Rezervacija promijenjena',
        context: input.context,
      });
    } catch (auditErr_) {
      useCaseLog.error(
        'audit.write_failed',
        auditErr_ instanceof Error ? auditErr_ : new Error(String(auditErr_)),
        { bookingId: input.id, operation: 'reservation.edit' },
      );
      // DEC-AU6: fail-open — the edit genuinely happened.
    }

    return { success: true, value: updated };
  };
};

// ---------------------------------------------------------------------------
// Pre-wired instance
// ---------------------------------------------------------------------------

import { bookingRepository } from '../infrastructure/repositories/DrizzleBookingRepository';
import { auditWriter } from '../infrastructure/adapters/auditWriterAdapter';

export const editBooking = makeEditBookingUseCase({
  bookingRepo: bookingRepository,
  auditWriter,
});
