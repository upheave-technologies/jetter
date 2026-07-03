// =============================================================================
// Bookings Module — Compute Availability Use Case
// =============================================================================
// Live verdict shown while creating/editing a booking.
//
// Takes { quantity, startTime, durationMin } and returns an AvailabilityVerdict:
//   { fits: true, freeAtSlot }  or
//   { fits: false, nextOpeningAt }
//
// Day-aware: loads records for the startTime's local day (DEC-P2).
// =============================================================================

import type { Result } from '@/packages/shared/lib/result';
import { log } from '@/packages/shared/observability';
import type { AvailabilityVerdict, BookingError } from '../domain/types';
import {
  fits as checkFits,
  peakCommitment,
  nextOpening as computeNextOpening,
} from '../domain/availability';
import { FLEET_SIZE, toLocalDayEnd, toLocalDayStart } from '../domain/config';
import type { IBookingRepository } from '../domain/repository';
import { bookingErr } from './bookingError';

const useCaseLog = log.child({ source: 'bookings.computeAvailabilityUseCase' });

export type ComputeAvailabilityDeps = {
  bookingRepo: IBookingRepository;
};

export type ComputeAvailabilityInput = {
  quantity: number;
  startTime: Date;
  durationMin: number;
};

export const makeComputeAvailabilityUseCase = (
  deps: ComputeAvailabilityDeps,
) => {
  return async (
    input: ComputeAvailabilityInput,
  ): Promise<Result<AvailabilityVerdict, BookingError>> => {
    const { bookingRepo } = deps;

    useCaseLog.debug('availability.compute_started', {
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

    const endTime = new Date(
      input.startTime.getTime() + input.durationMin * 60_000,
    );

    // --- Load & evaluate (day-scoped — DEC-P2) ----------------------------

    const dayStart = toLocalDayStart(input.startTime);
    const dayEnd = toLocalDayEnd(input.startTime);

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

    if (checkFits(allBookings, input.quantity, input.startTime, endTime)) {
      // DEC-F: report how many scooters are available during the requested window
      const freeAtSlot =
        FLEET_SIZE - peakCommitment(allBookings, input.startTime, endTime);
      return {
        success: true,
        value: { fits: true, freeAtSlot },
      };
    }

    // Doesn't fit — compute next opening
    const nextAt = computeNextOpening(
      allBookings,
      input.quantity,
      input.durationMin,
      input.startTime,
      dayEnd,
    );

    return {
      success: true,
      value: {
        fits: false,
        nextOpeningAt: nextAt,
      },
    };
  };
};

// ---------------------------------------------------------------------------
// Pre-wired instance
// ---------------------------------------------------------------------------

import { bookingRepository } from '../infrastructure/repositories/DrizzleBookingRepository';

export const computeAvailability = makeComputeAvailabilityUseCase({
  bookingRepo: bookingRepository,
});
