// =============================================================================
// Bookings Module — Propose Reconciliation Use Case
// =============================================================================
// Computes the minimal set of reservation changes that restores a feasible
// running order after a disruption. (DEC-P6)
//
// PURE QUERY — never writes to the database. Returns a proposal the operator
// must apply explicitly via applyReconciliationUseCase. Never auto-applies.
// =============================================================================

import type { Result } from '@/packages/shared/lib/result';
import { log } from '@/packages/shared/observability';
import type { Disruption, ReconciliationProposal, BookingError } from '../domain/types';
import { reconcile } from '../domain/availability';
import { FLEET_SIZE, toLocalDayStart, toLocalDayEnd } from '../domain/config';
import type { IBookingRepository } from '../domain/repository';
import { bookingErr } from './bookingError';

const useCaseLog = log.child({ source: 'bookings.proposeReconciliationUseCase' });

export type ProposeReconciliationDeps = {
  bookingRepo: IBookingRepository;
};

export type ProposeReconciliationInput = {
  day: Date;
  disruption: Disruption;
};

export const makeProposeReconciliationUseCase = (
  deps: ProposeReconciliationDeps,
) => {
  return async (
    input: ProposeReconciliationInput,
  ): Promise<Result<ReconciliationProposal, BookingError>> => {
    const { bookingRepo } = deps;
    const now = new Date();

    useCaseLog.debug('reconciliation.propose_started', {
      day: input.day.toISOString(),
      disruptionType: input.disruption.type,
    });

    const dayStart = toLocalDayStart(input.day);
    const dayEnd = toLocalDayEnd(input.day);

    let records;
    try {
      records = await bookingRepo.findByDay(dayStart, dayEnd);
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

    const proposal = reconcile(records, input.disruption, now, FLEET_SIZE, dayEnd);

    useCaseLog.info('reconciliation.proposed', {
      changes: proposal.changes.length,
      unresolvable: proposal.unresolvable.length,
    });

    return { success: true, value: proposal };
  };
};

// ---------------------------------------------------------------------------
// Pre-wired instance
// ---------------------------------------------------------------------------

import { bookingRepository } from '../infrastructure/repositories/DrizzleBookingRepository';

export const proposeReconciliation = makeProposeReconciliationUseCase({
  bookingRepo: bookingRepository,
});
