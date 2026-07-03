// =============================================================================
// Bookings Module — Public Domain Types
// =============================================================================
// Reservation-pivot (SPEC reservation-pivot, DEC-P1..DEC-P9).
// Type-only: no functions, no imports from application/ or infrastructure/.
// Domain is pure: no schema imports, no ORM types.
// =============================================================================

// ---------------------------------------------------------------------------
// Status & Kind
// ---------------------------------------------------------------------------

/** Lifecycle states. Terminal: 'cancelled'. Live: 'reserved'. (DEC-P1) */
export type BookingStatus = 'reserved' | 'cancelled';

/** Discriminates a revenue booking from a capacity-blocking maintenance window. (DEC-P3) */
export type BookingKind = 'reservation' | 'maintenance';

// ---------------------------------------------------------------------------
// Branded type alias
// ---------------------------------------------------------------------------

/** Booking primary key. Plain string at runtime; branded for type safety. */
export type BookingId = string & { readonly __brand: 'BookingId' };

// ---------------------------------------------------------------------------
// Core entity
// ---------------------------------------------------------------------------

/**
 * Domain representation of a booking row.
 * The window [startTime, endTime) is the SOLE fact availability needs. (DEC-P1)
 * No dispatchedAt, no returnedCount — the send-out lifecycle is removed.
 */
export type Booking = {
  id: BookingId;
  quantity: number;
  startTime: Date;
  endTime: Date;
  durationMin: number;
  renterName: string | null;
  notes: string | null;
  status: BookingStatus;
  kind: BookingKind;
  createdAt: Date;
  updatedAt: Date;
};

// ---------------------------------------------------------------------------
// Input types for use cases
// ---------------------------------------------------------------------------

/** Input for creating a reservation (kind='reservation' is implicit). */
export type CreateBookingInput = {
  quantity: number;
  startTime: Date;
  durationMin: number;
  renterName?: string | null;
  notes?: string | null;
};

/** Input for blocking scooters for maintenance (kind='maintenance' is implicit). (DEC-P3) */
export type CreateMaintenanceInput = {
  quantity: number;
  startTime: Date;
  endTime: Date;
  notes?: string | null;
};

/** Input for editing a reservation (reservations only; maintenance is immutable via edit). */
export type EditBookingInput = {
  id: BookingId;
  quantity?: number;
  startTime?: Date;
  durationMin?: number;
  renterName?: string | null;
  notes?: string | null;
};

/**
 * Input for editing a maintenance block (kind='maintenance' only).
 * Only provided fields are applied; endTime must remain after startTime.
 * NO fits() check (DEC-EM1 / DEC-P3). (SPEC bookings-edit-maintenance DEC-EM3)
 */
export type EditMaintenanceInput = {
  id: BookingId;
  quantity?: number;
  startTime?: Date;
  endTime?: Date;
  notes?: string | null;
};

// ---------------------------------------------------------------------------
// Availability types
// ---------------------------------------------------------------------------

/**
 * Discriminated union returned by the availability check. (R-AVAIL-2, DEC-F)
 * The doesn't-fit branch carries only nextOpeningAt — the operator's selected
 * quantity is already in the form.
 */
export type AvailabilityVerdict =
  | {
      fits: true;
      /**
       * Scooters that would be free during the requested [startTime, startTime+durationMin)
       * window. FLEET_SIZE - peakCommitment over the requested window.
       */
      freeAtSlot: number;
    }
  | {
      fits: false;
      /**
       * Earliest start at/after the requested start within the day where the
       * quantity fits for the duration. Null if no opening exists on that day.
       */
      nextOpeningAt: Date | null;
    };

/**
 * One time bucket in the density chart. (DEC-P4)
 * The UI stacks reserved + maintenance counts visually.
 */
export type DensityBucket = {
  start: Date;
  reservedCount: number;
  maintenanceCount: number;
};

/**
 * Result of the slot-finder query. (DEC-P5)
 * slots[0] === firstSlot; ordered earliest-first.
 */
export type OpenSlotsResult = {
  firstSlot: Date | null;
  slots: Date[];
};

/**
 * A disruption the operator reports for reconciliation. (DEC-P6)
 * delay — a reservation's scooters free up extraMinutes later than scheduled.
 * capacity_drop — N scooters malfunction from now until `until`.
 */
export type Disruption =
  | { type: 'delay'; bookingId: BookingId; extraMinutes: number }
  | { type: 'capacity_drop'; quantity: number; until: Date };

/** One proposed shift in a ReconciliationProposal. (DEC-P6) */
export type ReconciliationChange = {
  bookingId: BookingId;
  currentStart: Date;
  suggestedStart: Date;
  delayMinutes: number;
};

/**
 * The minimal set of reservation changes that restores a feasible running
 * order after a disruption. (DEC-P6) Proposal only — never auto-applied.
 */
export type ReconciliationProposal = {
  changes: ReconciliationChange[];
  unresolvable: BookingId[];
};

/**
 * Per-day utilization metrics. (DEC-P7)
 * utilizationPct = reservedScooterMinutes / max(1, capacityMinutes - maintenanceScooterMinutes) × 100
 */
export type UtilizationReport = {
  utilizationPct: number;
  reservedScooterMinutes: number;
  capacityMinutes: number;
  maintenanceScooterMinutes: number;
  idleScooterMinutes: number;
  peakConcurrent: number;
  busiestHourStart: Date | null;
  reservationCount: number;
};

/**
 * Everything the UI needs to render the full Board for one day. (DEC-P2, DEC-P4, DEC-P7)
 * Replaces BoardSnapshot.
 */
export type DayBoard = {
  /** The selected day (local midnight Zagreb, start of day). */
  day: Date;
  /** True when the selected day is today. */
  isToday: boolean;
  /** Server time at snapshot computation. */
  now: Date;
  /** Non-cancelled reservations for the day, sorted by startTime ASC. */
  reservations: Booking[];
  /** Non-cancelled maintenance blocks for the day, sorted by startTime ASC. */
  maintenance: Booking[];
  /**
   * Scooters free right now. Null when the selected day is not today —
   * "free now" is meaningless for a future or past day.
   */
  freeNow: number | null;
  /**
   * Next slot opening today (qty 1). Null when not today or no opening found.
   */
  nextOpeningAt: Date | null;
  /** Density profile buckets for the day. */
  density: DensityBucket[];
  /** Bucket size used to compute density (minutes). */
  bucketMin: number;
  /**
   * Start of the timeboxed window used for density and utilization
   * (floor-to-hour of the earliest confirmed reservation startTime).
   * Null when there are no confirmed reservations on the day.
   */
  windowStart: Date | null;
  /**
   * End of the timeboxed window used for density and utilization
   * (ceil-to-hour of the latest confirmed reservation endTime).
   * Null when there are no confirmed reservations on the day.
   */
  windowEnd: Date | null;
  /** Daily utilization metrics. */
  utilization: UtilizationReport;
};

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/**
 * Module-scoped error shape. Use cases return Result<T, BookingError>.
 *
 * PAST_START: cannot create/edit a reservation with startTime in the past.
 * IMMUTABLE_PAST: cannot modify a past-or-started reservation.
 * CAPACITY_EXCEEDED: requested booking doesn't fit current availability.
 */
export type BookingError = {
  code:
    | 'VALIDATION_ERROR'
    | 'NOT_FOUND'
    | 'CAPACITY_EXCEEDED'
    | 'PAST_START'
    | 'IMMUTABLE_PAST'
    | 'SERVICE_ERROR';
  message: string;
  details?: unknown;
};
