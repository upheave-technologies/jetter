// =============================================================================
// Bookings Module — Compute Open Slots Use Case
// =============================================================================
// Powers the slot-finder creation flow. (DEC-P5)
//
// Takes { quantity, durationMin, fromTime } and returns up to 8 feasible
// start times for that selection on the fromTime's local day.
// firstSlot = slots[0] ?? null.
// =============================================================================

import type { Result } from '@/packages/shared/lib/result';
import { log } from '@/packages/shared/observability';
import type { OpenSlotsResult, BookingError } from '../domain/types';
import { openSlots } from '../domain/availability';
import { FLEET_SIZE, toLocalDayStart, toLocalDayEnd } from '../domain/config';
import type { IBookingRepository } from '../domain/repository';
import { bookingErr } from './bookingError';

const useCaseLog = log.child({ source: 'bookings.computeOpenSlotsUseCase' });

export type ComputeOpenSlotsDeps = {
  bookingRepo: IBookingRepository;
};

export type ComputeOpenSlotsInput = {
  quantity: number;
  durationMin: number;
  fromTime: Date;
};

const MAX_SLOTS = 8;

export const makeComputeOpenSlotsUseCase = (deps: ComputeOpenSlotsDeps) => {
  return async (
    input: ComputeOpenSlotsInput,
  ): Promise<Result<OpenSlotsResult, BookingError>> => {
    const { bookingRepo } = deps;

    useCaseLog.debug('slots.compute_started', {
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

    if (!Number.isInteger(input.durationMin) || input.durationMin < 1) {
      return {
        success: false,
        error: bookingErr(
          'VALIDATION_ERROR',
          'Duration must be a positive integer number of minutes',
        ),
      };
    }

    if (!(input.fromTime instanceof Date) || isNaN(input.fromTime.getTime())) {
      return {
        success: false,
        error: bookingErr('VALIDATION_ERROR', 'Invalid fromTime'),
      };
    }

    // --- Load & compute ---------------------------------------------------

    const dayStart = toLocalDayStart(input.fromTime);
    const dayEnd = toLocalDayEnd(input.fromTime);

    let allBookings;
    try {
      allBookings = await bookingRepo.findByDay(dayStart, dayEnd);
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

    const slots = openSlots(
      allBookings,
      input.quantity,
      input.durationMin,
      input.fromTime,
      dayEnd,
      MAX_SLOTS,
    );

    const result: OpenSlotsResult = {
      firstSlot: slots[0] ?? null,
      slots,
    };

    useCaseLog.debug('slots.compute_done', { found: slots.length });
    return { success: true, value: result };
  };
};

// ---------------------------------------------------------------------------
// Pre-wired instance
// ---------------------------------------------------------------------------

import { bookingRepository } from '../infrastructure/repositories/DrizzleBookingRepository';

export const computeOpenSlots = makeComputeOpenSlotsUseCase({
  bookingRepo: bookingRepository,
});
