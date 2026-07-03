// =============================================================================
// Shared — Time Utility Helpers
// =============================================================================
// Pure, deterministic helpers for time-related UI logic.
// No I/O, no side effects, no Date.now() calls. Current time is always
// passed in as a parameter.
//
// Why: operators think in clock time anchored to the hour, not in relative
// offsets. When staring at a watch and a crowd, the mental load of "is +30
// from 09:49 the 10:19 I want, or the 10:15 I should round to?" is the
// problem this helper removes. Pickers that show absolute quarter-hour
// boundaries let the operator tap the time they mean, not an approximation.
//
// Day-nav helpers (DEC-P2): parseDayParam / formatDayParam / addDays.
// These sit here (not in domain/config.ts) because they are UI-layer
// helpers that belong on the app/lib boundary — frankie consumes them
// for building ?day= link hrefs; nexus consumes parseDayParam in page.tsx.
// =============================================================================

const ZAGREB_TZ = 'Europe/Zagreb';

// ---------------------------------------------------------------------------
// Day-navigation helpers (DEC-P2)
// ---------------------------------------------------------------------------

/**
 * Parses a `?day=YYYY-MM-DD` URL param into a Date anchored to local noon in
 * Europe/Zagreb on that calendar day.  Noon is used so that
 * `domain/config.ts#toLocalDayStart` — which derives the local day from a
 * passed-in Date — resolves to the intended day regardless of DST transitions.
 *
 * Falls back to `now` when the param is missing or not a valid YYYY-MM-DD.
 *
 * Pure: `now` is passed in; no Date.now() inside.
 */
export function parseDayParam(dayStr: string | undefined, now: Date): Date {
  if (!dayStr) return now;

  // Strict YYYY-MM-DD match.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayStr)) return now;

  const [yearStr, monthStr, dayOfMonthStr] = dayStr.split('-');
  const year = parseInt(yearStr!, 10);
  const month = parseInt(monthStr!, 10);
  const dayOfMonth = parseInt(dayOfMonthStr!, 10);

  if (
    isNaN(year) ||
    isNaN(month) ||
    isNaN(dayOfMonth) ||
    month < 1 ||
    month > 12 ||
    dayOfMonth < 1 ||
    dayOfMonth > 31
  ) {
    return now;
  }

  // Build a local noon on that date in Europe/Zagreb by constructing an ISO
  // string and letting the Intl machinery do the tz conversion.
  // Strategy: use Date.UTC for noon UTC, then adjust using the known offset.
  // Simpler and reliable: build via a 'YYYY-MM-DDT12:00:00' local string.
  // JavaScript's Date constructor does NOT parse local times reliably, so we
  // use the en-CA formatter round-trip approach from domain/config.ts.

  // Start with UTC noon on the target date and walk it to Zagreb noon.
  const utcNoon = new Date(Date.UTC(year, month - 1, dayOfMonth, 12, 0, 0, 0));

  // Verify the date is valid by checking the formatted parts match the input.
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZAGREB_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(utcNoon);
  const fmt = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? '';

  const formattedYear = fmt('year');
  const formattedMonth = fmt('month');
  const formattedDay = fmt('day');

  // If the formatted date doesn't match our target it could be an invalid day
  // (e.g. 2024-02-30). Fall back to now.
  if (
    formattedYear !== String(year).padStart(4, '0') ||
    formattedMonth !== String(month).padStart(2, '0') ||
    formattedDay !== String(dayOfMonth).padStart(2, '0')
  ) {
    return now;
  }

  return utcNoon;
}

/**
 * Formats a Date to a `YYYY-MM-DD` string in Europe/Zagreb local time.
 * Used to build `?day=` href params for Prev/Next/Today navigation.
 *
 * Pure: no Date.now() inside.
 */
export function formatDayParam(day: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZAGREB_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(day);
}

/**
 * Adds `n` days (positive = forward, negative = backward) to `day` and
 * returns a new Date anchored to local noon in Europe/Zagreb on the result.
 *
 * Uses the same noon-anchor strategy as parseDayParam so that the returned
 * Date is safe to pass into toLocalDayStart / getDayBoard.
 *
 * Pure: no Date.now() inside.
 */
export function addDays(day: Date, n: number): Date {
  // Add n × 24 h worth of ms.  This is DST-naive, but the noon anchor keeps
  // us safe: if the clocks spring forward +1 h, we land at 11:00 Zagreb, and
  // toLocalDayStart still derives the correct local day.  If they fall back
  // −1 h, we land at 13:00 Zagreb — equally safe.
  return new Date(day.getTime() + n * 24 * 60 * 60 * 1000);
}

const QUARTER_HOUR_MS = 15 * 60 * 1000;

/**
 * Returns the next `count` quarter-hour boundaries strictly after `now`.
 *
 * A quarter-hour boundary is any time whose minutes are 0, 15, 30, or 45.
 * If `now` is already on a quarter-hour boundary (e.g. 10:00:00.000), the
 * first element is the *next* boundary (10:15) — we never offer "now" as a
 * preset.
 *
 * Examples:
 *   nextQuarterHourBoundaries(09:49, 4) → [10:00, 10:15, 10:30, 10:45]
 *   nextQuarterHourBoundaries(10:00, 4) → [10:15, 10:30, 10:45, 11:00]
 *
 * Why strictly after: the caller is typically creating a future event. Offering
 * "now" as a time-chip races the clock and produces confusing UX on any
 * availability verdict (the start is already in the past by the time the user
 * taps submit). An explicit future boundary is always the safer default.
 *
 * @param now   - Current wall-clock time (never reads Date.now() internally).
 * @param count - Number of boundaries to return. Must be ≥ 1.
 */
export function nextQuarterHourBoundaries(now: Date, count: number): Date[] {
  const nowMs = now.getTime();

  // Round up to the next multiple of 15 minutes.
  // Math.ceil handles the "already on a boundary" case by producing the same
  // value; we then advance one more step so the result is strictly after now.
  const ceilMs = Math.ceil(nowMs / QUARTER_HOUR_MS) * QUARTER_HOUR_MS;

  // If now is exactly on a boundary, ceil produces now itself — advance one step.
  const firstMs = ceilMs === nowMs ? ceilMs + QUARTER_HOUR_MS : ceilMs;

  const result: Date[] = [];
  for (let i = 0; i < count; i++) {
    result.push(new Date(firstMs + i * QUARTER_HOUR_MS));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Form time helpers — shared by BookingFormContainer and BookingEditContainer
// ---------------------------------------------------------------------------

/**
 * Formats a Date to a locale-aware "HH:MM" string for Europe/Zagreb.
 *
 * Why: operators in the Zagreb timezone read 24h clock time on screen; the
 * locale formatter is the only reliable way to produce that display without
 * rolling manual UTC-offset arithmetic.
 *
 * @param date - The Date to format.
 */
export function formatHHMM(date: Date): string {
  return date.toLocaleTimeString('hr-HR', {
    timeZone: 'Europe/Zagreb',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Parses an "HH:MM" string into a Date on the same calendar day as `now`.
 * Returns null for empty or malformed input.
 *
 * Why: the `now` parameter anchors the result to the day shown on screen,
 * making the function deterministic — callers never rely on the system clock
 * inside this function (architecture.md §3 — pure core).
 *
 * @param hhmm - The HH:MM string from a manual time input field.
 * @param now  - Current wall-clock time used to anchor the date component.
 */
export function parseHHMM(hhmm: string, now: Date): Date | null {
  if (!hhmm || !hhmm.includes(':')) return null;
  const [hhStr, mmStr] = hhmm.split(':');
  const hh = parseInt(hhStr ?? '', 10);
  const mm = parseInt(mmStr ?? '', 10);
  if (isNaN(hh) || isNaN(mm)) return null;
  // Copy `now` so we don't mutate the caller's reference.
  const d = new Date(now.getTime());
  d.setHours(hh, mm, 0, 0);
  return d;
}

/**
 * Resolves the start time in milliseconds from the form's selection state.
 * Returns null when no valid start time is set.
 *
 * Why: two input surfaces (chip selection and manual HH:MM text) write to
 * different state slots; this function is the single resolution point so
 * both containers share identical semantics (architecture.md §5 — no
 * duplicate behavior).
 *
 * @param selectedTime - A Date chosen via a quarter-hour chip, or null.
 * @param custStart    - The raw HH:MM string from the manual input field.
 * @param now          - Current wall-clock time, anchors parseHHMM.
 */
export function resolveStartMs(
  selectedTime: Date | null,
  custStart: string,
  now: Date,
): number | null {
  if (selectedTime !== null) return selectedTime.getTime();
  if (!custStart || !custStart.includes(':')) return null;
  const [hhStr, mmStr] = custStart.split(':');
  const hh = parseInt(hhStr ?? '', 10);
  const mm = parseInt(mmStr ?? '', 10);
  if (isNaN(hh) || isNaN(mm)) return null;
  const d = new Date(now.getTime());
  d.setHours(hh, mm, 0, 0);
  return d.getTime();
}

/**
 * Resolves the booking duration in minutes from the form's preset + custom
 * input state. Falls back to 30 min when the custom value is unparseable.
 *
 * Why: the same two-surface pattern as start time — a numeric preset OR a
 * free-text number. Single canonical resolution keeps both containers in
 * sync.
 *
 * @param preset          - One of 30 | 45 | 60 | 'custom'.
 * @param customDurationMin - Free-text string when preset === 'custom'.
 */
export function resolveDurationMin(
  preset: 30 | 45 | 60 | 'custom',
  customDurationMin: string,
): number {
  if (preset === 'custom') {
    const v = parseInt(customDurationMin, 10);
    return isNaN(v) || v < 1 ? 30 : v;
  }
  return preset;
}
