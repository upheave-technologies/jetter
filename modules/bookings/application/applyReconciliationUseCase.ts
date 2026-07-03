// =============================================================================
// Bookings Module — Apply Reconciliation Use Case
// =============================================================================
// Applies a ReconciliationProposal produced by proposeReconciliationUseCase.
// (DEC-P6) — the human must have explicitly chosen to apply the proposal.
//
// Idempotent: each change sets an ABSOLUTE suggestedStart, so re-applying the
// same proposal produces the same final state (the second apply finds the
// booking already at suggestedStart and the endTime is the same).
//
// Skips any change whose booking is missing or already cancelled.
//
// DEC-AU5/DEC-AU6: After all changes are applied, records ONE audit event for
// the reconciliation (entityType='reconciliation', action='apply', entityId=null
// since this is a batch operation). The before/after capture the list of shifts.
// Fail-open: audit failure logs CRITICAL but does NOT fail the user's action.
// =============================================================================

import type { Result } from '@/packages/shared/lib/result';
import { log } from '@/packages/shared/observability';
import type { ReconciliationProposal, BookingError } from '../domain/types';
import type { IBookingRepository } from '../domain/repository';
import type { AuditWriter, AuditContext } from './ports/auditWriter';
import { bookingErr } from './bookingError';

const useCaseLog = log.child({ source: 'bookings.applyReconciliationUseCase' });

export type ApplyReconciliationDeps = {
  bookingRepo: IBookingRepository;
  auditWriter: AuditWriter;
};

export type ApplyReconciliationInput = {
  proposal: ReconciliationProposal;
  context?: AuditContext;
};

export type ApplyReconciliationOutput = {
  applied: number;
  skipped: number;
};

export const makeApplyReconciliationUseCase = (
  deps: ApplyReconciliationDeps,
) => {
  return async (
    input: ApplyReconciliationInput,
  ): Promise<Result<ApplyReconciliationOutput, BookingError>> => {
    const { bookingRepo, auditWriter } = deps;
    const now = new Date();

    useCaseLog.debug('reconciliation.apply_started', {
      changes: input.proposal.changes.length,
    });

    let applied = 0;
    let skipped = 0;

    // Capture shifts for the audit before/after snapshot
    const appliedShifts: Array<{
      bookingId: string;
      previousStart: string;
      newStart: string;
      delayMinutes: number;
    }> = [];

    for (const change of input.proposal.changes) {
      let booking;
      try {
        booking = await bookingRepo.findById(change.bookingId);
      } catch (err) {
        useCaseLog.error(
          'booking.findById_failed',
          err instanceof Error ? err : new Error(String(err)),
          { bookingId: change.bookingId },
        );
        return {
          success: false,
          error: bookingErr('SERVICE_ERROR', 'Failed to load booking during apply'),
        };
      }

      // Skip missing or cancelled bookings (idempotent — may have been cancelled
      // between propose and apply)
      if (booking === null || booking.status === 'cancelled') {
        skipped++;
        continue;
      }

      // Apply absolute suggestedStart; preserve durationMin
      const newStart = change.suggestedStart;
      const newEnd = new Date(newStart.getTime() + booking.durationMin * 60_000);

      const updated = {
        ...booking,
        startTime: newStart,
        endTime: newEnd,
        updatedAt: now,
      };

      try {
        await bookingRepo.update(updated);
        applied++;
        appliedShifts.push({
          bookingId: change.bookingId as string,
          previousStart: change.currentStart.toISOString(),
          newStart: change.suggestedStart.toISOString(),
          delayMinutes: change.delayMinutes,
        });
        useCaseLog.info('reconciliation.change_applied', {
          bookingId: change.bookingId,
          delayMinutes: change.delayMinutes,
        });
      } catch (err) {
        useCaseLog.error(
          'booking.update_failed',
          err instanceof Error ? err : new Error(String(err)),
          { bookingId: change.bookingId },
        );
        return {
          success: false,
          error: bookingErr('SERVICE_ERROR', 'Failed to apply reconciliation change'),
        };
      }
    }

    useCaseLog.info('reconciliation.applied', { applied, skipped });

    // --- Audit (DEC-AU5/DEC-AU6) -----------------------------------------
    // One audit event for the whole reconciliation batch. entityId=null (batch
    // operation with no single entity). before=prior schedule summary,
    // after=shifts applied.
    try {
      await auditWriter.record({
        entityType: 'reconciliation',
        action: 'apply',
        entityId: null,
        before: { changes: input.proposal.changes.map((c) => ({
          bookingId: c.bookingId as string,
          currentStart: c.currentStart.toISOString(),
          suggestedStart: c.suggestedStart.toISOString(),
          delayMinutes: c.delayMinutes,
        })) },
        after: { applied, skipped, shifts: appliedShifts },
        summary: 'Uskađivanje primijenjeno',
        context: input.context,
      });
    } catch (auditErr_) {
      useCaseLog.error(
        'audit.write_failed',
        auditErr_ instanceof Error ? auditErr_ : new Error(String(auditErr_)),
        { operation: 'reconciliation.apply', applied, skipped },
      );
      // DEC-AU6: fail-open — the reconciliation genuinely happened.
    }

    return { success: true, value: { applied, skipped } };
  };
};

// ---------------------------------------------------------------------------
// Pre-wired instance
// ---------------------------------------------------------------------------

import { bookingRepository } from '../infrastructure/repositories/DrizzleBookingRepository';
import { auditWriter } from '../infrastructure/adapters/auditWriterAdapter';

export const applyReconciliation = makeApplyReconciliationUseCase({
  bookingRepo: bookingRepository,
  auditWriter,
});
