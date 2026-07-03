// =============================================================================
// Bookings Module — Drizzle Booking Repository
// =============================================================================
// Implements IBookingRepository using node-postgres (`pg`) + Drizzle ORM.
//
// Mapping conventions:
//   - DB rows use `timestamptz` columns; Drizzle's { mode: 'date' } maps them
//     to JS Date objects at the boundary (see schema/bookings.ts). Domain code
//     continues to see plain `Date` values — the same interface as the former
//     SQLite build, which stored unix-ms integers.
//   - All nullable columns use null (not undefined) in both directions.
//   - The domain BookingId branded type is cast from/to plain string.
//
// Reservation-pivot changes (DEC-P1, DEC-P3):
//   - rowToBooking: maps 'kind'; removes returnedCount / dispatchedAt.
//   - bookingToInsert: includes 'kind'; removes returnedCount / dispatchedAt.
//   - findToday renamed to findByDay — generalized to any day range.
//   - findAll removed (zero consumers after pivot — donnie-rules §2).
//
// No soft-delete filter: this table has no deleted_at column. Status
// expresses the full lifecycle. Documented deviation from the standard
// donnie repository pattern (carried forward from booth-board SPEC).
// =============================================================================

import { and, asc, eq, gte, lt } from 'drizzle-orm';

import { log } from '@/packages/shared/observability';
import type { Booking, BookingId, BookingStatus, BookingKind } from '../../domain/types';
import type { IBookingRepository } from '../../domain/repository';
import { bookings } from '../../schema';
import { getBookingsDatabase, type BookingsDatabase } from '../database';

const repoLog = log.child({ source: 'bookings.DrizzleBookingRepository' });

// ---------------------------------------------------------------------------
// Row ↔ Domain mapping
// ---------------------------------------------------------------------------

type BookingRow = {
  id: string;
  quantity: number;
  startTime: Date;
  endTime: Date;
  durationMin: number;
  renterName: string | null;
  notes: string | null;
  status: string;
  kind: string;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Maps a Drizzle-hydrated row to a domain Booking.
 * The repository boundary is where ORM/schema types stop and domain types begin.
 */
function rowToBooking(row: BookingRow): Booking {
  return {
    id: row.id as BookingId,
    quantity: row.quantity,
    startTime: row.startTime,
    endTime: row.endTime,
    durationMin: row.durationMin,
    renterName: row.renterName,
    notes: row.notes,
    status: row.status as BookingStatus,
    kind: row.kind as BookingKind,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Maps a domain Booking to the shape expected by Drizzle's insert/update.
 */
function bookingToInsert(b: Booking) {
  return {
    id: b.id as string,
    quantity: b.quantity,
    startTime: b.startTime,
    endTime: b.endTime,
    durationMin: b.durationMin,
    renterName: b.renterName,
    notes: b.notes,
    status: b.status,
    kind: b.kind,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a booking repository backed by the given database instance.
 *
 * @param db - Optional Drizzle database handle. Defaults to the singleton
 *   returned by getBookingsDatabase(). Pass a test-scoped instance to isolate
 *   tests without touching the real database file.
 */
export function makeBookingRepository(
  db?: BookingsDatabase,
): IBookingRepository {
  const resolvedDb = db ?? getBookingsDatabase();

  return {
    async findById(id: BookingId): Promise<Booking | null> {
      const start = Date.now();
      const rows = await resolvedDb
        .select()
        .from(bookings)
        .where(eq(bookings.id, id as string))
        .limit(1);

      const durationMs = Date.now() - start;
      if (durationMs > 200) {
        repoLog.warn('booking.findById_slow', { bookingId: id, durationMs });
      }

      if (rows.length === 0) return null;
      return rowToBooking(rows[0]);
    },

    async findByDay(dayStart: Date, dayEnd: Date): Promise<Booking[]> {
      const start = Date.now();
      const rows = await resolvedDb
        .select()
        .from(bookings)
        .where(
          and(
            gte(bookings.startTime, dayStart),
            lt(bookings.startTime, dayEnd),
          ),
        )
        .orderBy(asc(bookings.startTime));

      const durationMs = Date.now() - start;
      repoLog.debug('booking.findByDay.done', {
        count: rows.length,
        durationMs,
        dayStart: dayStart.toISOString(),
        dayEnd: dayEnd.toISOString(),
      });

      return rows.map(rowToBooking);
    },

    async save(booking: Booking): Promise<void> {
      const start = Date.now();
      await resolvedDb.insert(bookings).values(bookingToInsert(booking));

      const durationMs = Date.now() - start;
      repoLog.info('booking.saved', { bookingId: booking.id, durationMs });
    },

    async update(booking: Booking): Promise<void> {
      const start = Date.now();
      await resolvedDb
        .update(bookings)
        .set({
          quantity: booking.quantity,
          startTime: booking.startTime,
          endTime: booking.endTime,
          durationMin: booking.durationMin,
          renterName: booking.renterName,
          notes: booking.notes,
          status: booking.status,
          kind: booking.kind,
          updatedAt: booking.updatedAt,
        })
        .where(eq(bookings.id, booking.id as string));

      const durationMs = Date.now() - start;
      repoLog.info('booking.updated', { bookingId: booking.id, durationMs });
    },
  };
}

// ---------------------------------------------------------------------------
// Pre-wired singleton (used by application-layer pre-wired use cases)
// ---------------------------------------------------------------------------

/**
 * Process-wide singleton repository. All use case pre-wired instances share
 * this. Tests should use makeBookingRepository(testDb) instead.
 */
export const bookingRepository = makeBookingRepository();
