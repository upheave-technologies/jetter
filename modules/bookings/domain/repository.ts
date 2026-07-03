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

  /**
   * Execute `fn` atomically under a per-day Postgres advisory lock.
   *
   * Opens a database transaction, immediately acquires
   * `pg_advisory_xact_lock(dayKey)` where dayKey is derived from `day`
   * (days-since-epoch as a bigint), then invokes `fn` with a tx-scoped
   * IBookingRepository that shares that transaction. The lock is released
   * automatically when the transaction commits or rolls back.
   *
   * Purpose: serialise all capacity-mutating writes for the same calendar day.
   * Concurrent writers for the same day queue on the advisory lock; the loser
   * re-reads inside its own transaction, re-runs fits(), and gets a clean
   * CAPACITY_EXCEEDED if the winner already filled capacity.
   *
   * Usage: callers wrap their read → fits() → write sequence inside `fn`.
   * The `txRepo` passed to `fn` shares the open transaction; both reads and
   * writes through it are part of the same atomic unit.
   *
   * The audit write (DEC-AU6 fail-open) MUST remain outside this call.
   */
  withDayLock: <T>(day: Date, fn: (txRepo: IBookingRepository) => Promise<T>) => Promise<T>;
};
