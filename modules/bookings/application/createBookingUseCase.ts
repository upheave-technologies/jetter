// =============================================================================
// Bookings Module — Create Booking Use Case
// =============================================================================
// Creates a reservation (kind='reservation').
//
// DEC-P2: startTime must be strictly in the future (PAST_START).
// R-AVAIL-2 / DEC-B: fits() is ALWAYS enforced. No brute-force override.
// If a race condition causes CAPACITY_EXCEEDED at submit, the UI surfaces it
// as an error banner.
//
// DEC-AU5/DEC-AU6: After a successful save, records an audit event via the
// injected AuditWriter port. On audit failure, logs CRITICAL and returns the
// successful mutation result — the booking genuinely happened (fail-open).
// Accepted residual risk: a booking without an audit row is possible only if
// the audit DB write fails; that gap is always loudly logged (never swallowed).
// A shared transaction would prevent the gap but requires coupling the two
// modules' db handles, which violates module isolation (DEC-AU6 decision).
// =============================================================================

import { nanoid } from 'nanoid';

import type { Result } from '@/packages/shared/lib/result';
import { log } from '@/packages/shared/observability';
import type { Booking, BookingId, CreateBookingInput, BookingError } from '../domain/types';
import { fits } from '../domain/availability';
import { FLEET_SIZE, toLocalDayStart, toLocalDayEnd } from '../domain/config';
import type { IBookingRepository } from '../domain/repository';
import type { AuditWriter, AuditContext } from './ports/auditWriter';
import { bookingErr } from './bookingError';

const useCaseLog = log.child({ source: 'bookings.createBookingUseCase' });

export type CreateBookingDeps = {
  bookingRepo: IBookingRepository;
  auditWriter: AuditWriter;
};

export const makeCreateBookingUseCase = (deps: CreateBookingDeps) => {
  return async (
    input: CreateBookingInput & { context?: AuditContext },
  ): Promise<Result<Booking, BookingError>> => {
    const { bookingRepo, auditWriter } = deps;
    const now = new Date();

    useCaseLog.debug('booking.create_started', {
      quantity: input.quantity,
      durationMin: input.durationMin,
    });

    // --- Validation -------------------------------------------------------

    if (
      !Number.isInteger(input.quantity) ||
      input.quantity < 1 ||
      input.quantity > FLEET_SIZE
    ) {
      return {
        success: false,
        error: bookingErr(
          'VALIDATION_ERROR',
          `Quantity must be between 1 and ${FLEET_SIZE}`,
        ),
      };
    }

    if (!(input.startTime instanceof Date) || isNaN(input.startTime.getTime())) {
      return {
        success: false,
        error: bookingErr('VALIDATION_ERROR', 'Invalid start time'),
      };
    }

    if (!Number.isInteger(input.durationMin) || input.durationMin < 1) {
      return {
        success: false,
        error: bookingErr(
          'VALIDATION_ERROR',
          'Duration must be a positive integer number of minutes',
        ),
      };
    }

    // DEC-P2: reservations must start in the future
    if (input.startTime.getTime() <= now.getTime()) {
      return {
        success: false,
        error: bookingErr('PAST_START', 'Rezervacija mora početi u budućnosti'),
      };
    }

    const endTime = new Date(
      input.startTime.getTime() + input.durationMin * 60_000,
    );

    // --- Availability check (always enforced) ----------------------------

    let allBookings: Booking[];
    try {
      allBookings = await bookingRepo.findByDay(
        toLocalDayStart(input.startTime),
        toLocalDayEnd(input.startTime),
      );
    } catch (err) {
      useCaseLog.error(
        'booking.findByDay_failed',
        err instanceof Error ? err : new Error(String(err)),
      );
      return {
        success: false,
        error: bookingErr('SERVICE_ERROR', 'Failed to load bookings'),
      };
    }

    if (!fits(allBookings, input.quantity, input.startTime, endTime)) {
      useCaseLog.info('booking.capacity_exceeded', { quantity: input.quantity });
      return {
        success: false,
        error: bookingErr(
          'CAPACITY_EXCEEDED',
          'Rezervacija ne stane u trenutnu dostupnost',
        ),
      };
    }

    // --- Build & save -----------------------------------------------------

    const booking: Booking = {
      id: nanoid() as BookingId,
      quantity: input.quantity,
      startTime: input.startTime,
      endTime,
      durationMin: input.durationMin,
      renterName: input.renterName ?? null,
      notes: input.notes ?? null,
      status: 'reserved',
      kind: 'reservation',
      createdAt: now,
      updatedAt: now,
    };

    try {
      await bookingRepo.save(booking);
    } catch (err) {
      useCaseLog.error(
        'booking.save_failed',
        err instanceof Error ? err : new Error(String(err)),
        { bookingId: booking.id },
      );
      return {
        success: false,
        error: bookingErr('SERVICE_ERROR', 'Failed to save booking'),
      };
    }

    useCaseLog.info('booking.created', { bookingId: booking.id });

    // --- Audit (DEC-AU5/DEC-AU6) -----------------------------------------
    // Fail-open: the booking was committed. Audit failure is logged CRITICAL
    // but does NOT fail the user's action (DEC-AU6). The gap is always visible
    // in logs — never swallowed (architecture.md §5/§7).
    try {
      await auditWriter.record({
        entityType: 'reservation',
        action: 'create',
        entityId: booking.id,
        before: null,
        after: booking,
        summary: 'Rezervacija stvorena',
        context: input.context,
      });
    } catch (auditErr_) {
      // DEC-AU6: log CRITICAL — this is a gap in the audit trail, always loud.
      useCaseLog.error(
        'audit.write_failed',
        auditErr_ instanceof Error ? auditErr_ : new Error(String(auditErr_)),
        { bookingId: booking.id, operation: 'reservation.create' },
      );
      // Return success — the booking genuinely happened (DEC-AU6 fail-open).
    }

    return { success: true, value: booking };
  };
};

// ---------------------------------------------------------------------------
// Pre-wired instance
// ---------------------------------------------------------------------------

import { bookingRepository } from '../infrastructure/repositories/DrizzleBookingRepository';
import { auditWriter } from '../infrastructure/adapters/auditWriterAdapter';

export const createBooking = makeCreateBookingUseCase({
  bookingRepo: bookingRepository,
  auditWriter,
});
