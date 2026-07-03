// =============================================================================
// Bookings Module — Status & Kind Enums (PostgreSQL)
// =============================================================================
// Each domain is enforced at three layers:
//   1. TypeScript level — the union types below (BookingStatus / BookingKind),
//      imported by the domain layer, repository, use cases, and server actions.
//   2. Database level — real PostgreSQL `pgEnum` types (`booking_status`,
//      `booking_kind`). drizzle-kit emits `CREATE TYPE … AS ENUM (…)` and the
//      `status` / `kind` columns in `./bookings.ts` reference them, so the
//      database itself rejects any value outside the tuple. This replaces the
//      old SQLite `text` + CHECK mirror — Postgres has native enums (archie-rules
//      §2.V / §7: "Enums → PostgreSQL pgEnum, defined in enums.ts").
//   3. The const tuples (BOOKING_STATUS / BOOKING_KIND) remain the single source
//      of truth: both the TS union types AND the pgEnum value lists derive from
//      them, so adding a value touches exactly one tuple here and nothing else.
//
// --- status ---
// The reservation pivot (SPEC reservation-pivot, DEC-P1) collapses the old
// send-out lifecycle (booked | out | returned | cancelled) to two states. The
// reservation IS the source of truth for availability — there is no longer a
// physical "handed out" step, no partial-return tracking, and no dispatch
// timestamp. A record is either a live commitment or it is voided:
//   reserved  → a live commitment occupying [start_time, end_time)
//   cancelled → voided, capacity freed (terminal)
//
// --- kind ---
// DEC-P3 adds a discriminator so a capacity-blocking maintenance window lives
// on the SAME unified timeline as a reservation. A maintenance block consumes
// `quantity` scooters over [start_time, end_time) exactly like a reservation in
// the availability math — one timeline, one fit function, zero drift. Default
// is 'reservation' (the overwhelming majority of rows and the back-compatible
// value for any insert that predates the column):
//   reservation → revenue-bearing commitment (fills the utilization numerator)
//   maintenance → capacity removed for repair (reduces the utilization denom.)
// =============================================================================

import { pgEnum } from 'drizzle-orm/pg-core';

export const BOOKING_STATUS = ['reserved', 'cancelled'] as const;

export type BookingStatus = (typeof BOOKING_STATUS)[number];

export const BOOKING_KIND = ['reservation', 'maintenance'] as const;

export type BookingKind = (typeof BOOKING_KIND)[number];

// Native Postgres enum types. The column definitions in `./bookings.ts`
// reference these; drizzle-kit emits a `CREATE TYPE booking_status AS ENUM
// ('reserved', 'cancelled')` (and the kind equivalent) in the generated
// migration. Derived from the tuples above so the DB enum, the TS union, and
// the runtime value list never drift.
export const bookingStatusEnum = pgEnum('booking_status', BOOKING_STATUS);

export const bookingKindEnum = pgEnum('booking_kind', BOOKING_KIND);
