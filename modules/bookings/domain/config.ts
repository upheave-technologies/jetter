// =============================================================================
// Bookings Module — System Configuration Constants
// =============================================================================
// All system parameters from FSD §7 are hard-coded here.
// Reservation-pivot: removed LATE_GRACE_MIN, NO_SHOW_GRACE_MIN,
// END_OF_DAY_LOCAL_HOUR (lifecycle-bound constants, superseded by DEC-P1).
// Added density bucket sizes (DEC-P4).
// Timebox pivot: removed OPERATING_DAY_START_HOUR, OPERATING_DAY_END_HOUR,
// operatingWindowStart, operatingWindowEnd — density and utilization are now
// timeboxed to the actual booked window; added floorToHour/ceilToHour helpers.
// =============================================================================

// ---------------------------------------------------------------------------
// Fleet & booking constants
// ---------------------------------------------------------------------------

/** Total scooters available (FSD §7). */
export const FLEET_SIZE = 8;

/**
 * Minimum slot granularity in minutes. All offered start times snap to the
 * nearest multiple of this value on the absolute epoch-ms grid (aligned to
 * wall-clock :00/:05/…/:55 for Europe/Zagreb since the zone offset is a whole
 * number of minutes). R-AVAIL-6.
 */
export const SLOT_GRANULARITY_MIN = 5;

/** Standard rental durations in minutes (FSD §7). */
export const STANDARD_DURATIONS_MIN = [30, 45, 60] as const;

/**
 * Turnaround buffer: a returned ski stays unavailable for this many minutes
 * after the rental ends. Default 0 (FSD §7). R-AVAIL-5.
 */
export const TURNAROUND_BUFFER_MIN = 0;

// ---------------------------------------------------------------------------
// Density bucket sizes (DEC-P4)
// ---------------------------------------------------------------------------

/** Default density bucket size in minutes (popular-times chart). */
export const DENSITY_BUCKET_MIN_DEFAULT = 15;

/** Fine-grained density bucket size in minutes (toggle option). */
export const DENSITY_BUCKET_MIN_FINE = 5;

// ---------------------------------------------------------------------------
// Timezone & day-boundary helpers
// ---------------------------------------------------------------------------

/** The operational timezone for the booth (FSD §7). */
export const BOOTH_TIMEZONE = 'Europe/Zagreb';

// Formatter reused across helper calls — created once at module load.
const zagrebFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BOOTH_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/**
 * Returns a Date representing 00:00:00.000 on the local calendar day that
 * `now` falls within, expressed in Europe/Zagreb.
 *
 * Pure: no Date.now() inside.
 */
export function toLocalDayStart(now: Date): Date {
  const parts = zagrebFormatter.formatToParts(now);
  const get = (type: string) =>
    parseInt(parts.find((p) => p.type === type)!.value, 10);

  const year = get('year');
  const month = get('month');
  const day = get('day');

  const approxNoon = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));

  const noonParts = zagrebFormatter.formatToParts(approxNoon);
  const noonGet = (type: string) =>
    parseInt(noonParts.find((p) => p.type === type)!.value, 10);

  const localHour = noonGet('hour') === 24 ? 0 : noonGet('hour');
  const localMin = noonGet('minute');
  const localSec = noonGet('second');

  const utcHourMs = 12 * 3_600_000;
  const localHourMs = localHour * 3_600_000 + localMin * 60_000 + localSec * 1000;
  const offsetMs = localHourMs - utcHourMs;

  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0) - offsetMs);
}

/**
 * Returns a Date representing the exclusive upper bound of the local calendar
 * day — 00:00:00.000 of the next local day (Zagreb).
 *
 * Pure: no Date.now() inside.
 */
export function toLocalDayEnd(now: Date): Date {
  const dayStart = toLocalDayStart(now);
  return new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Hour-boundary helpers (timebox pivot)
// ---------------------------------------------------------------------------

const HOUR_MS = 3_600_000;

/**
 * Floors `d` to the epoch-ms hour boundary.
 *
 * Math: `Math.floor(ms / 3_600_000) * 3_600_000`.
 * Europe/Zagreb's UTC offset is a whole number of hours, so the result lands on
 * a wall-clock :00 in local time.
 *
 * Pure: no Date.now() inside. Deterministic over epoch-ms.
 */
export function floorToHour(d: Date): Date {
  const ms = d.getTime();
  return new Date(Math.floor(ms / HOUR_MS) * HOUR_MS);
}

/**
 * Ceils `d` to the epoch-ms hour boundary. If `d` is already exactly on an
 * hour boundary, it is returned unchanged (ceil of a grid-aligned value is
 * itself).
 *
 * Math: `Math.ceil(ms / 3_600_000) * 3_600_000`.
 * Europe/Zagreb's UTC offset is a whole number of hours, so the result lands on
 * a wall-clock :00 in local time.
 *
 * Pure: no Date.now() inside. Deterministic over epoch-ms.
 */
export function ceilToHour(d: Date): Date {
  const ms = d.getTime();
  return new Date(Math.ceil(ms / HOUR_MS) * HOUR_MS);
}
