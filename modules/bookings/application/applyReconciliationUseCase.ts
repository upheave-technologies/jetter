// =============================================================================
// Bookings Module — Apply Reconciliation Use Case
// =============================================================================
// Applies a ReconciliationProposal produced by proposeReconciliationUseCase.
// (DEC-P6) — the human must have explicitly chosen to apply the proposal.
//
// Concurrency safety (concurrency fix):
// The entire read → re-validate → write batch runs inside a per-day Postgres
// advisory lock (withDayLock), which:
//   (a) Serialises against all other capacity-mutating writers for the same day
//       so no booking can land between the snapshot read and the updates; and
//   (b) Wraps all updates in a single transaction, making the batch all-or-
//       nothing and preventing partial-application on mid-batch failure.
//
// Between propose and apply a new booking may have been committed. The use
// case re-reads all day bookings (inside the lock), re-validates the proposal
// against the fresh snapshot using proposalFeasible(), and returns
// RECONCILIATION_STALE without writing anything if the proposal no longer fits.
// The operator must then re-propose.
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
// The audit write is intentionally OUTSIDE the withDayLock closure (DEC-AU6).
// =============================================================================

import type { Result } from '@/packages/shared/lib/result';
import { log } from '@/packages/shared/observability';
import type { ReconciliationProposal, BookingError } from '../domain/types';
import { proposalFeasible } from '../domain/availability';
import { FLEET_SIZE, toLocalDayStart, toLocalDayEnd } from '../domain/config';
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

    // --- Early exit: nothing to apply ------------------------------------
    if (input.proposal.changes.length === 0) {
      useCaseLog.info('reconciliation.applied', { applied: 0, skipped: 0 });
      return { success: true, value: { applied: 0, skipped: 0 } };
    }

    // --- Derive the day to lock ------------------------------------------
    // All changes in a proposal pertain to the same calendar day (reconcile
    // operates on a single day's timeline). Use the first change's currentStart
    // to derive the day boundary — currentStart is the booking's start at
    // propose-time, guaranteed to fall on the day the operator reconciled.
    const lockDay = toLocalDayStart(input.proposal.changes[0].currentStart);
    const dayEnd = toLocalDayEnd(input.proposal.changes[0].currentStart);

    // Capture shifts for the audit before/after snapshot (built inside lock)
    let applied = 0;
    let skipped = 0;
    const appliedShifts: Array<{
      bookingId: string;
      previousStart: string;
      newStart: string;
      delayMinutes: number;
    }> = [];

    // --- Atomic read → re-validate → write (inside advisory lock) --------
    // withDayLock opens a transaction, acquires pg_advisory_xact_lock for the
    // day key, then calls fn with a tx-scoped repository. All reads and writes
    // inside are part of the same atomic unit. A concurrent writer for the same
    // day (create/edit reservation, blockScooter, editMaintenance) blocks here
    // until the transaction commits, then re-reads and re-validates against
    // the committed state.
    try {
      const lockResult = await bookingRepo.withDayLock(
        lockDay,
        async (txRepo) => {
          // Re-read current state of the day under the lock so we see any
          // booking committed between propose and apply.
          const currentRecords = await txRepo.findByDay(lockDay, dayEnd);

          // Re-validate: confirm the proposed end-state still fits within
          // FLEET_SIZE given the fresh snapshot (DEC-P9 sacred core — no
          // capacity math here; delegate entirely to the domain function).
          if (!proposalFeasible(currentRecords, input.proposal, FLEET_SIZE)) {
            return { stale: true as const };
          }

          // Apply all updates atomically (transaction = all-or-nothing).
          for (const change of input.proposal.changes) {
            const booking = currentRecords.find((b) => b.id === change.bookingId) ?? null;

            // Skip missing or cancelled bookings (idempotent — may have been
            // cancelled between propose and apply).
            if (booking === null || booking.status === 'cancelled') {
              skipped++;
              continue;
            }

            const newStart = change.suggestedStart;
            const newEnd = new Date(newStart.getTime() + booking.durationMin * 60_000);

            const updated = {
              ...booking,
              startTime: newStart,
              endTime: newEnd,
              updatedAt: now,
            };

            await txRepo.update(updated);
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
          }

          return { stale: false as const };
        },
      );

      if (lockResult.stale) {
        useCaseLog.info('reconciliation.stale', {
          changes: input.proposal.changes.length,
        });
        return {
          success: false,
          error: bookingErr(
            'RECONCILIATION_STALE',
            'Prijedlog više nije izvediv — nova rezervacija primljena od prijedloga. Molimo predložite ponovo.',
          ),
        };
      }
    } catch (err) {
      useCaseLog.error(
        'reconciliation.apply_failed',
        err instanceof Error ? err : new Error(String(err)),
        { changes: input.proposal.changes.length },
      );
      return {
        success: false,
        error: bookingErr('SERVICE_ERROR', 'Failed to apply reconciliation'),
      };
    }

    useCaseLog.info('reconciliation.applied', { applied, skipped });

    // --- Audit (DEC-AU5/DEC-AU6) -----------------------------------------
    // One audit event for the whole reconciliation batch. entityId=null (batch
    // operation with no single entity). before=prior schedule summary,
    // after=shifts applied.
    // OUTSIDE the withDayLock closure — the reconciliation was committed;
    // audit failure must not roll it back (DEC-AU6 fail-open).
    try {
      await auditWriter.record({
        entityType: 'reconciliation',
        action: 'apply',
        entityId: null,
        before: {
          changes: input.proposal.changes.map((c) => ({
            bookingId: c.bookingId as string,
            currentStart: c.currentStart.toISOString(),
            suggestedStart: c.suggestedStart.toISOString(),
            delayMinutes: c.delayMinutes,
          })),
        },
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
