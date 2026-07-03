// =============================================================================
// Bookings Module — Cancel Booking Use Case
// =============================================================================
// Cancel a booking (reservation or maintenance block).
//
// Cancellability rules (DEC-P2) are enforced via canCancel() — a pure domain
// function in domain/booking.ts (donnie-rules §6.1: policy in pure functions).
//   reservation → cancellable only if startTime > now
//   maintenance → cancellable any time end > now
//
// DEC-AU5/DEC-AU6: After a successful update, records an audit event via the
// injected AuditWriter port. entityType follows the booking's kind (reservation
// or maintenance). Fail-open: audit failure logs CRITICAL but does NOT fail the
// user's action.
// =============================================================================

import type { Result } from '@/packages/shared/lib/result';
import { log } from '@/packages/shared/observability';
import type { Booking, BookingId, BookingError } from '../domain/types';
import { canCancel } from '../domain/booking';
import type { IBookingRepository } from '../domain/repository';
import type { AuditWriter, AuditContext } from './ports/auditWriter';
import { bookingErr } from './bookingError';

const useCaseLog = log.child({ source: 'bookings.cancelBookingUseCase' });

export type CancelBookingDeps = {
  bookingRepo: IBookingRepository;
  auditWriter: AuditWriter;
};

export type CancelBookingInput = {
  id: BookingId;
  context?: AuditContext;
};

export const makeCancelBookingUseCase = (deps: CancelBookingDeps) => {
  return async (
    input: CancelBookingInput,
  ): Promise<Result<Booking, BookingError>> => {
    const { bookingRepo, auditWriter } = deps;
    const now = new Date();

    useCaseLog.debug('booking.cancel_started', { bookingId: input.id });

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

    // Domain policy: canCancel() encapsulates the rule (donnie-rules §6.1)
    if (!canCancel(booking, now)) {
      return {
        success: false,
        error: bookingErr(
          'IMMUTABLE_PAST',
          booking.status === 'cancelled'
            ? `Booking is already cancelled`
            : `Cannot cancel a ${booking.kind} that has already started or ended`,
        ),
      };
    }

    // Capture before-snapshot for audit
    const bookingBefore: Booking = { ...booking };

    const updated: Booking = {
      ...booking,
      status: 'cancelled',
      updatedAt: now,
    };

    try {
      await bookingRepo.update(updated);
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

    useCaseLog.info('booking.cancelled', { bookingId: booking.id });

    // --- Audit (DEC-AU5/DEC-AU6) -----------------------------------------
    // entityType follows the booking's kind — reservation vs maintenance.
    const summary =
      booking.kind === 'reservation'
        ? 'Rezervacija otkazana'
        : 'Nedostupnost otkazana';
    try {
      await auditWriter.record({
        entityType: booking.kind,
        action: 'cancel',
        entityId: updated.id,
        before: bookingBefore,
        after: updated,
        summary,
        context: input.context,
      });
    } catch (auditErr_) {
      useCaseLog.error(
        'audit.write_failed',
        auditErr_ instanceof Error ? auditErr_ : new Error(String(auditErr_)),
        { bookingId: input.id, operation: `${booking.kind}.cancel` },
      );
      // DEC-AU6: fail-open — the cancellation genuinely happened.
    }

    return { success: true, value: updated };
  };
};

// ---------------------------------------------------------------------------
// Pre-wired instance
// ---------------------------------------------------------------------------

import { bookingRepository } from '../infrastructure/repositories/DrizzleBookingRepository';
import { auditWriter } from '../infrastructure/adapters/auditWriterAdapter';

export const cancelBooking = makeCancelBookingUseCase({
  bookingRepo: bookingRepository,
  auditWriter,
});
