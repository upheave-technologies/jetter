// =============================================================================
// Bookings Module — Edit Maintenance Use Case
// =============================================================================
// Edit an existing maintenance block (kind='maintenance').
//
// DEC-EM1: separate use case from editBookingUseCase — maintenance edit
// semantics differ materially (no fits() check, different editable fields,
// different editability window). One use case per concern.
//
// DEC-EM2: editability predicate canEditMaintenance(booking, now) — a block
// is editable while it hasn't fully ended and isn't cancelled. Editing a
// still-running block is legitimate (DEC-EM2: a repair in progress is exactly
// the moment you adjust it).
//
// DEC-EM3: merge-then-validate — only provided fields change; endTime must
// remain after startTime; quantity stays within 1..FLEET_SIZE; NO fits() check
// (maintenance is honest over-commitment, DEC-P3); durationMin recomputed.
//
// Concurrency: the update runs under a per-day advisory lock
// (pg_advisory_xact_lock) so it serializes with concurrent reservation writers
// for the same day. A concurrent createBooking sees the committed maintenance
// update in its findByDay read, preserving a consistent capacity picture.
//
// DEC-EM6 / DEC-AU5 / DEC-AU6: records audit event (maintenance.edit) via
// injected AuditWriter port with before/after snapshots. Fail-open: audit
// failure logs CRITICAL but does NOT fail the edit.
// The audit write is intentionally outside the advisory-lock transaction.
// =============================================================================

import type { Result } from '@/packages/shared/lib/result';
import { log } from '@/packages/shared/observability';
import type { Booking, EditMaintenanceInput, BookingError } from '../domain/types';
import { canEditMaintenance } from '../domain/booking';
import { FLEET_SIZE, toLocalDayStart } from '../domain/config';
import type { IBookingRepository } from '../domain/repository';
import type { AuditWriter, AuditContext } from './ports/auditWriter';
import { bookingErr } from './bookingError';

const useCaseLog = log.child({ source: 'bookings.editMaintenanceUseCase' });

export type EditMaintenanceDeps = {
  bookingRepo: IBookingRepository;
  auditWriter: AuditWriter;
};

export const makeEditMaintenanceUseCase = (deps: EditMaintenanceDeps) => {
  return async (
    input: EditMaintenanceInput & { context?: AuditContext },
  ): Promise<Result<Booking, BookingError>> => {
    const { bookingRepo, auditWriter } = deps;
    const now = new Date();

    useCaseLog.debug('maintenance.edit_started', { bookingId: input.id });

    // --- Input validation (before load to fail fast) ----------------------

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
      input.startTime !== undefined &&
      (!(input.startTime instanceof Date) || isNaN(input.startTime.getTime()))
    ) {
      return {
        success: false,
        error: bookingErr('VALIDATION_ERROR', 'Invalid start time'),
      };
    }

    if (
      input.endTime !== undefined &&
      (!(input.endTime instanceof Date) || isNaN(input.endTime.getTime()))
    ) {
      return {
        success: false,
        error: bookingErr('VALIDATION_ERROR', 'Invalid end time'),
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

    // DEC-EM1: reject editing a reservation through this maintenance-specific path
    if (booking.kind !== 'maintenance') {
      return {
        success: false,
        error: bookingErr(
          'NOT_FOUND',
          `Booking ${input.id} is not a maintenance block`,
        ),
      };
    }

    // DEC-EM2: canEditMaintenance gate — pure predicate from domain/
    if (!canEditMaintenance(booking, now)) {
      return {
        success: false,
        error: bookingErr(
          'IMMUTABLE_PAST',
          booking.status === 'cancelled'
            ? 'Cannot edit a cancelled maintenance block'
            : 'Cannot edit a maintenance block that has already ended',
        ),
      };
    }

    // Capture before-snapshot for audit
    const bookingBefore: Booking = { ...booking };

    // --- Merge & validate ------------------------------------------------

    const newQuantity = input.quantity ?? booking.quantity;
    const newStartTime = input.startTime ?? booking.startTime;
    const newEndTime = input.endTime ?? booking.endTime;

    if (newEndTime.getTime() <= newStartTime.getTime()) {
      return {
        success: false,
        error: bookingErr('VALIDATION_ERROR', 'End time must be after start time'),
      };
    }

    // Recompute durationMin from (endTime - startTime) — matches the create path
    const durationMin = Math.round(
      (newEndTime.getTime() - newStartTime.getTime()) / 60_000,
    );

    // NO fits() check (DEC-EM1 / DEC-P3 / DEC-EM3 — maintenance is honest
    // over-commitment; the operator records reality regardless of fleet size).
    // The update runs under a per-day advisory lock to serialize with
    // concurrent reservation writers, which see this committed update via
    // findByDay inside their own locked transactions.

    const day = toLocalDayStart(newStartTime);

    let updated: Booking;
    try {
      updated = await bookingRepo.withDayLock(day, async (txRepo) => {
        const u: Booking = {
          ...booking!,
          quantity: newQuantity,
          startTime: newStartTime,
          endTime: newEndTime,
          durationMin,
          notes: input.notes !== undefined ? input.notes : booking!.notes,
          updatedAt: now,
        };

        await txRepo.update(u);
        return u;
      });
    } catch (err) {
      useCaseLog.error(
        'booking.update_failed',
        err instanceof Error ? err : new Error(String(err)),
        { bookingId: input.id },
      );
      return {
        success: false,
        error: bookingErr('SERVICE_ERROR', 'Failed to update maintenance block'),
      };
    }

    useCaseLog.info('maintenance.edited', { bookingId: input.id });

    // --- Audit (DEC-EM6 / DEC-AU5 / DEC-AU6) ----------------------------
    try {
      await auditWriter.record({
        entityType: 'maintenance',
        action: 'edit',
        entityId: updated.id,
        before: bookingBefore,
        after: updated,
        summary: 'Nedostupnost promijenjena',
        context: input.context,
      });
    } catch (auditErr_) {
      useCaseLog.error(
        'audit.write_failed',
        auditErr_ instanceof Error ? auditErr_ : new Error(String(auditErr_)),
        { bookingId: input.id, operation: 'maintenance.edit' },
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

export const editMaintenance = makeEditMaintenanceUseCase({
  bookingRepo: bookingRepository,
  auditWriter,
});
