// =============================================================================
// Bookings Module — Get Day Board Use Case
// =============================================================================
// Primary data source for the Board page. Computes in one shot:
//   - Reservation and maintenance partitions for the day
//   - freeNow (null when not today — meaningless for other days)
//   - nextOpeningAt (today only)
//   - density profile (DEC-P4)
//   - utilization report (DEC-P7)
//
// Replaces getBoardSnapshotUseCase and listTodayUseCase. (DEC-P2)
// =============================================================================

import type { Result } from '@/packages/shared/lib/result';
import { log } from '@/packages/shared/observability';
import type { DayBoard, BookingError } from '../domain/types';
import {
  freeNow as computeFreeNow,
  nextOpening as computeNextOpening,
  densityProfile,
  utilizationReport,
} from '../domain/availability';
import {
  FLEET_SIZE,
  DENSITY_BUCKET_MIN_DEFAULT,
  toLocalDayStart,
  toLocalDayEnd,
  floorToHour,
  ceilToHour,
} from '../domain/config';
import type { IBookingRepository } from '../domain/repository';
import { bookingErr } from './bookingError';

const useCaseLog = log.child({ source: 'bookings.getDayBoardUseCase' });

export type GetDayBoardDeps = {
  bookingRepo: IBookingRepository;
};

export type GetDayBoardInput = {
  day: Date;
  bucketMin?: number;
};

export const makeGetDayBoardUseCase = (deps: GetDayBoardDeps) => {
  return async (
    input: GetDayBoardInput,
  ): Promise<Result<DayBoard, BookingError>> => {
    const { bookingRepo } = deps;
    const now = new Date();

    const bucketMin = input.bucketMin ?? DENSITY_BUCKET_MIN_DEFAULT;

    useCaseLog.debug('board.get_day_started', {
      day: input.day.toISOString(),
      bucketMin,
    });

    const dayStart = toLocalDayStart(input.day);
    const dayEnd = toLocalDayEnd(input.day);

    // Determine if the requested day is today
    const todayStart = toLocalDayStart(now);
    const isToday = dayStart.getTime() === todayStart.getTime();

    let allRecords;
    try {
      allRecords = await bookingRepo.findByDay(dayStart, dayEnd);
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

    // Partition by kind (keep all statuses for display; cancelled show as history)
    const reservations = allRecords
      .filter((b) => b.kind === 'reservation' && b.status !== 'cancelled')
      .sort((a, z) => a.startTime.getTime() - z.startTime.getTime());

    const maintenance = allRecords
      .filter((b) => b.kind === 'maintenance' && b.status !== 'cancelled')
      .sort((a, z) => a.startTime.getTime() - z.startTime.getTime());

    // freeNow: only meaningful for today
    const freeNowValue = isToday ? computeFreeNow(allRecords, now) : null;

    // nextOpeningAt: only for today
    const nextOpeningAt =
      isToday
        ? computeNextOpening(allRecords, 1, 1, now, dayEnd)
        : null;

    // Timebox: derive window from confirmed reservations only (kind='reservation', status!='cancelled').
    // Maintenance blocks do NOT define the bounds — they are clipped to the window for display/metrics.
    const confirmedReservations = allRecords.filter(
      (b) => b.kind === 'reservation' && b.status !== 'cancelled',
    );

    let windowStart: Date | null = null;
    let windowEnd: Date | null = null;

    if (confirmedReservations.length > 0) {
      const earliestStart = confirmedReservations.reduce(
        (min, b) => (b.startTime.getTime() < min.getTime() ? b.startTime : min),
        confirmedReservations[0].startTime,
      );
      const latestEnd = confirmedReservations.reduce(
        (max, b) => (b.endTime.getTime() > max.getTime() ? b.endTime : max),
        confirmedReservations[0].endTime,
      );
      windowStart = floorToHour(earliestStart);
      windowEnd = ceilToHour(latestEnd);
    }

    // Density profile — timeboxed to [windowStart, windowEnd) when reservations exist;
    // empty array when no confirmed reservations (null window → degenerate safe case).
    const density =
      windowStart !== null && windowEnd !== null
        ? densityProfile(allRecords, windowStart, windowEnd, bucketMin)
        : [];

    // Utilization report — timeboxed to [windowStart, windowEnd).
    // When no confirmed reservations, use a 1-minute stub window to avoid divide-by-zero;
    // all metrics come out 0 and utilizationPct = 0.
    const utilWindow =
      windowStart !== null && windowEnd !== null
        ? { start: windowStart, end: windowEnd }
        : { start: dayStart, end: new Date(dayStart.getTime() + 60_000) };

    const utilization = utilizationReport(allRecords, utilWindow.start, utilWindow.end, FLEET_SIZE);

    useCaseLog.info('board.get_day_done', {
      isToday,
      reservations: reservations.length,
      maintenance: maintenance.length,
      freeNow: freeNowValue,
    });

    const board: DayBoard = {
      day: dayStart,
      isToday,
      now,
      reservations,
      maintenance,
      freeNow: freeNowValue,
      nextOpeningAt,
      density,
      bucketMin,
      windowStart,
      windowEnd,
      utilization,
    };

    return { success: true, value: board };
  };
};

// ---------------------------------------------------------------------------
// Pre-wired instance
// ---------------------------------------------------------------------------

import { bookingRepository } from '../infrastructure/repositories/DrizzleBookingRepository';

export const getDayBoard = makeGetDayBoardUseCase({
  bookingRepo: bookingRepository,
});
