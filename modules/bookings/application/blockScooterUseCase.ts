// =============================================================================
// Bookings Module — Block Scooter Use Case
// =============================================================================
// Creates a maintenance block (kind='maintenance').
//
// DEC-P3: does NOT enforce fits() — a malfunction is reality. Recording an
// honest over-commitment is correct; reconciliation (DEC-P6) resolves it.
// Operators must be able to record reality even when it exceeds fleet size.
//
// Concurrency: the save runs under a per-day advisory lock
// (pg_advisory_xact_lock) so it serializes with concurrent reservation writers
// for the same day. This ensures that a concurrent createBooking sees the
// committed maintenance block when it reads findByDay inside its own locked
// transaction — preventing reservations from being booked over a maintenance
// block that was committed concurrently.
//
// DEC-AU5/DEC-AU6: After a successful save, records an audit event via the
// injected AuditWriter port. entityType='maintenance', action='create'.
// Fail-open: audit failure logs CRITICAL but does NOT fail the user's action.
// The audit write is intentionally outside the advisory-lock transaction.
// =============================================================================

import { nanoid } from 'nanoid';

import type { Result } from '@/packages/shared/lib/result';
import { log } from '@/packages/shared/observability';
import type { Booking, BookingId, CreateMaintenanceInput, BookingError } from '../domain/types';
import { FLEET_SIZE, toLocalDayStart } from '../domain/config';
import type { IBookingRepository } from '../domain/repository';
import type { AuditWriter, AuditContext } from './ports/auditWriter';
import { bookingErr } from './bookingError';

const useCaseLog = log.child({ source: 'bookings.blockScooterUseCase' });

export type BlockScooterDeps = {
  bookingRepo: IBookingRepository;
  auditWriter: AuditWriter;
};

export const makeBlockScooterUseCase = (deps: BlockScooterDeps) => {
  return async (
    input: CreateMaintenanceInput & { context?: AuditContext },
  ): Promise<Result<Booking, BookingError>> => {
    const { bookingRepo, auditWriter } = deps;
    const now = new Date();

    useCaseLog.debug('maintenance.block_started', {
      quantity: input.quantity,
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

    if (!(input.endTime instanceof Date) || isNaN(input.endTime.getTime())) {
      return {
        success: false,
        error: bookingErr('VALIDATION_ERROR', 'Invalid end time'),
      };
    }

    if (input.endTime.getTime() <= input.startTime.getTime()) {
      return {
        success: false,
        error: bookingErr('VALIDATION_ERROR', 'End time must be after start time'),
      };
    }

    const durationMin = Math.round(
      (input.endTime.getTime() - input.startTime.getTime()) / 60_000,
    );

    // --- Build & save under per-day advisory lock (NO fits() check — DEC-P3) ---
    // No capacity check: operators record reality regardless of fleet size.
    // The lock serializes this write with concurrent reservation writers for
    // the same day so they see this committed block in their findByDay read.

    const day = toLocalDayStart(input.startTime);

    let booking: Booking;
    try {
      booking = await bookingRepo.withDayLock(day, async (txRepo) => {
        const b: Booking = {
          id: nanoid() as BookingId,
          quantity: input.quantity,
          startTime: input.startTime,
          endTime: input.endTime,
          durationMin,
          renterName: null,
          notes: input.notes ?? null,
          status: 'reserved',
          kind: 'maintenance',
          createdAt: now,
          updatedAt: now,
        };

        await txRepo.save(b);
        return b;
      });
    } catch (err) {
      useCaseLog.error(
        'maintenance.save_failed',
        err instanceof Error ? err : new Error(String(err)),
      );
      return {
        success: false,
        error: bookingErr('SERVICE_ERROR', 'Failed to save maintenance block'),
      };
    }

    useCaseLog.info('maintenance.blocked', { bookingId: booking.id });

    // --- Audit (DEC-AU5/DEC-AU6) -----------------------------------------
    try {
      await auditWriter.record({
        entityType: 'maintenance',
        action: 'create',
        entityId: booking.id,
        before: null,
        after: booking,
        summary: 'Nedostupnost / kvar zabilježen',
        context: input.context,
      });
    } catch (auditErr_) {
      useCaseLog.error(
        'audit.write_failed',
        auditErr_ instanceof Error ? auditErr_ : new Error(String(auditErr_)),
        { bookingId: booking.id, operation: 'maintenance.create' },
      );
      // DEC-AU6: fail-open — the maintenance block genuinely happened.
    }

    return { success: true, value: booking };
  };
};

// ---------------------------------------------------------------------------
// Pre-wired instance
// ---------------------------------------------------------------------------

import { bookingRepository } from '../infrastructure/repositories/DrizzleBookingRepository';
import { auditWriter } from '../infrastructure/adapters/auditWriterAdapter';

export const blockScooter = makeBlockScooterUseCase({
  bookingRepo: bookingRepository,
  auditWriter,
});
