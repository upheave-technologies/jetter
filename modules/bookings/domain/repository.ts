// =============================================================================
// Bookings Module — IBookingRepository Interface
// =============================================================================
// Contract only — defines what the repository does, not how it does it.
// Implementations live in infrastructure/repositories/.
//
// findAll is removed: it had zero consumers after the reservation-pivot and
// grew without bound across seasons (donnie-rules §2 unbounded query rule).
// findByDay is the primary read — it bounds the SQL scan to one calendar day.
// =============================================================================

import type { Booking, BookingId } from './types';

export type IBookingRepository = {
  /**
   * Find a booking by primary key.
   * Returns null if no booking with that id exists.
   */
  findById: (id: BookingId) => Promise<Booking | null>;

  /**
   * Return every booking (both kinds, all statuses) whose startTime falls
   * within the given day window: startTime >= dayStart AND startTime < dayEnd.
   * Results are ordered by startTime ASC.
   *
   * Why: pushes the date-range filter to SQL so the 2-second poll cycle never
   * scans every historical row. dayStart and dayEnd are computed by the
   * application layer via toLocalDayStart/toLocalDayEnd — the repository
   * stays free of timezone logic.
   *
   * Both kinds (reservation + maintenance) are returned; application layer
   * partitions by kind as needed. All statuses are returned; application
   * layer filters by status as needed.
   */
  findByDay: (dayStart: Date, dayEnd: Date) => Promise<Booking[]>;

  /**
   * Insert a new booking row.
   * The caller is responsible for generating the id before calling save.
   */
  save: (booking: Booking) => Promise<void>;

  /**
   * Full-row update by id.
   * Used by all mutation use cases after loading and mutating in memory.
   */
  update: (booking: Booking) => Promise<void>;
};
