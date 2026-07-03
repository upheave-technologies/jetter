// =============================================================================
// Bookings Module — Schema Public API
// =============================================================================
// This is the schema directory barrel — the single exception to the project's
// no-barrel rule, per archie-rules.md §1 and project-structure.md §5.
// Consumers (the database wiring + repository) import the table, the enum
// objects, and the types from here; nothing else re-exports.
//
// The raw `bookingsCreateTableSql` / `bookingsCreateIndexSql` fragments that the
// SQLite lazy-bootstrap relied on are GONE — the module now provisions its
// schema via generated drizzle-kit migrations, not a runtime CREATE TABLE.
// =============================================================================

export { bookings } from './bookings';
export type { BookingRow, NewBookingRow } from './bookings';
export { BOOKING_STATUS, BOOKING_KIND, bookingStatusEnum, bookingKindEnum } from './enums';
export type { BookingStatus, BookingKind } from './enums';
