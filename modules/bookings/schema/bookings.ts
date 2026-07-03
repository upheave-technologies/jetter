// =============================================================================
// Bookings Module — Bookings Table (PostgreSQL)
// =============================================================================
// One row per record on the reservation-density Board. A record is either a
// reservation (revenue-bearing) or a maintenance block (capacity removed), both
// living on one unified timeline. The Board is favour-grade, single instance,
// no auth, no multi-tenancy — see the booth-board SPEC decisions #1/#2 and the
// reservation-pivot SPEC (DEC-P1, DEC-P2, DEC-P3).
//
// Storage migration (this change-unit): the module moved from SQLite
// (better-sqlite3, lazy `CREATE TABLE IF NOT EXISTS` bootstrap) to PostgreSQL
// (Neon in production, local Docker Postgres in dev) via the node-postgres `pg`
// driver behind a single `DATABASE_URL`. The lazy bootstrap is replaced by real
// drizzle-kit migrations (`generate` + `migrate`). There is no in-place data
// migration: the old gitignored `data/board.db` is dev-only scratch and the
// cloud Postgres is greenfield — a fresh database receives this schema from the
// generated migration. (See the Minimal Change Report's LOCAL-DB-RESET note.)
//
// Design decisions:
//   - id is a server-generated nanoid (text) inserted at the use-case layer.
//     This ID strategy is carried forward UNCHANGED from the SQLite build: the
//     repository produces the id on save, so there is deliberately NO DB-level
//     default here. Minimal churn — the migration changes the column's storage
//     engine, not who generates the value. (archie-rules §2.V: text IDs only;
//     satisfied by the text PK.)
//   - Timestamps are now `timestamptz` (`timestamp(..., { withTimezone: true,
//     mode: 'date' })`) — the Postgres-native instant type and the archie-rules
//     §2.V required timestamp shape. Drizzle maps them to JS `Date` at the
//     boundary, so domain code still sees `Date` exactly as before; the
//     SQLite-era INTEGER unix-ms storage (the documented §2.V exception) is gone.
//   - status / kind are real PostgreSQL enums (`bookingStatusEnum` /
//     `bookingKindEnum` from `./enums.ts`), not text + CHECK. (archie-rules
//     §2.V / §7.) status collapses to `reserved | cancelled` (DEC-P1); kind
//     discriminates reservation vs. maintenance with default `'reservation'`
//     (DEC-P3). The reservation's window [start_time, end_time) is the sole
//     source of truth for availability: the prior send-out lifecycle
//     (`out` / `returned`), `dispatched_at`, and `returned_count` are gone.
//   - A maintenance row consumes `quantity` scooters over its window exactly
//     like a reservation, so the existing pure fit functions apply unchanged.
//   - No `deleted_at` / soft-delete column. The booth-board SPEC removed auth,
//     tenancy, and soft-delete from this build; `status = 'cancelled'` is the
//     terminal void state. This is a DOCUMENTED, CARRIED-FORWARD deviation from
//     archie-rules §3 (soft-delete mandatory) — established in the booth-board
//     build and explicitly NOT reintroduced by the reservation pivot
//     (reservation-pivot SPEC, Scope "Still out of scope"). The Postgres
//     migration does not change this decision; it only changes the storage
//     engine.
//   - CHECK constraints enforce the FSD's invariants at the storage layer so
//     the database itself rejects nonsense (archie-rules §2.III). Now that the
//     module uses real drizzle-kit migrations, the CHECKs live in the table
//     definition via pg-core `check()` so drizzle-kit emits them in the
//     generated SQL (in the SQLite era they lived in a hand-written CREATE TABLE
//     string because there was no migration pipeline):
//       quantity BETWEEN 1 AND 8  -- FSD §7 fleet size
//       end_time > start_time      -- non-degenerate window
//     status / kind no longer need a CHECK — the pgEnum types enforce their
//     domains natively.
//   - Index strategy (DEC-P2): the dominant read is "every record for a given
//     day" — a `start_time` range scan (`findByDay`). A single
//     `idx_bookings_start_time` serves that range directly; it leads on
//     start_time because the day bound is always present and is the selective
//     predicate. Neither `status` nor `kind` gets its own index: a single day
//     returns at most a few dozen rows, so splitting that small result set by
//     status or kind in memory is cheaper than the write tax of extra indexes on
//     every insert/update (archie-rules §2.VI — index where queries hit, not
//     where they might). If a future day grows large enough to justify a
//     composite `(kind, start_time)` index, adding it is now a one-line schema
//     change + `drizzle-kit generate` (no longer constrained by the single-
//     statement `db.run` bootstrap the SQLite build used).
// =============================================================================

import { pgTable, text, integer, timestamp, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { bookingStatusEnum, bookingKindEnum } from './enums';

export const bookings = pgTable(
  'bookings',
  {
    id: text('id').primaryKey().notNull(),

    quantity: integer('quantity').notNull(),

    // timestamptz. Drizzle returns `Date` thanks to mode: 'date'.
    startTime: timestamp('start_time', { withTimezone: true, mode: 'date' }).notNull(),
    endTime: timestamp('end_time', { withTimezone: true, mode: 'date' }).notNull(),

    // Cached duration in minutes. Trivially derivable from end - start, but
    // stored explicitly so the operator's chosen preset (30 / 45 / 60 vs.
    // a custom value) survives edits to a future reservation.
    durationMin: integer('duration_min').notNull(),

    renterName: text('renter_name'),
    notes: text('notes'),

    status: bookingStatusEnum('status').notNull(),

    // Discriminates a reservation from a capacity-blocking maintenance window.
    // Default 'reservation' (DEC-P3). Both kinds consume `quantity` scooters
    // over [start_time, end_time) on the same availability timeline.
    kind: bookingKindEnum('kind').notNull().default('reservation'),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => ({
    // Primary hot read (DEC-P2): all records for one day, by start_time range.
    startTimeIdx: index('idx_bookings_start_time').on(table.startTime),

    // FSD §7 fleet size: a record commits between 1 and 8 scooters.
    quantityRange: check('bookings_quantity_range', sql`${table.quantity} BETWEEN 1 AND 8`),
    // Non-degenerate window: the booking must occupy positive time.
    windowOrder: check('bookings_window_order', sql`${table.endTime} > ${table.startTime}`),
  }),
);

export type BookingRow = typeof bookings.$inferSelect;
export type NewBookingRow = typeof bookings.$inferInsert;
