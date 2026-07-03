#!/usr/bin/env node
// infra/dev-seed.mjs — dummy "packed day" seed for the jet reservation board (dev only).
//
// Builds a realistic BUSY day for TODAY (Europe/Zagreb), across the 08:00–20:00
// operating window, against a fleet of 8 units. Concurrency rises to a midday
// peak of 6–8 and tapers morning/evening, but NEVER exceeds 8 at any instant —
// a running concurrency timeline is computed as rows are placed, and any row
// that would breach the fleet is skipped (so the board stays brutally accurate).
//
// Target DB: process.env.DATABASE_URL (the HOST-FACING connection string —
//   host `localhost`, the mapped Postgres port; see infra/.env). The board
//   CONTAINER uses a separate in-network URL; this script runs on the host, so
//   it uses the host-facing one. Matches modules/bookings/infrastructure/
//   database.ts + drizzle.config.ts (both read DATABASE_URL via the `pg` driver).
//
// Storage migration: this script moved from better-sqlite3 (a local file) to
// the node-postgres `pg` driver. The generation math is UNCHANGED — only the
// read/write layer differs. Timestamps are now `timestamptz`: start/end/created/
// updated are inserted as JS `Date` objects (node-postgres serializes Date →
// timestamptz). The generation still works in unix-ms internally and wraps with
// `new Date(ms)` at insert time. status/kind are pgEnum-typed; the string
// literals bind fine as parameters.
//
// Idempotent: clears the bookings table first, then seeds with a fixed RNG seed
// and a fixed timeline shape, so re-running yields the same packed day for TODAY.
//
// Run with: pnpm seed
//   (export DATABASE_URL first — e.g. `export $(grep -v '^#' infra/.env | xargs)`
//    or `DATABASE_URL=postgres://jet:jet@localhost:5432/jet pnpm seed`)

import pg from 'pg';
import { nanoid } from 'nanoid';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const TZ = 'Europe/Zagreb';
const FLEET = 8;
const OPEN_HOUR = 8; // 08:00 local
const CLOSE_HOUR = 20; // 20:00 local
const DURATIONS = [30, 45, 60]; // minutes
const QUANTITIES = [1, 2, 3, 4]; // units per reservation

// ---------------------------------------------------------------------------
// Deterministic RNG (mulberry32) — fixed seed → same packed day every run.
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(0x1e7c0de); // "jet code"
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const randint = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

// ---------------------------------------------------------------------------
// Timezone helpers — resolve "today 08:00 Zagreb" to unix-ms regardless of DST.
// ---------------------------------------------------------------------------
function zagrebOffsetMs(date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(
    dtf
      .formatToParts(date)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]),
  );
  // 24:00 normalisation guard
  const hour = parts.hour === '24' ? 0 : +parts.hour;
  const asUTC = Date.UTC(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    hour,
    +parts.minute,
    +parts.second,
  );
  return asUTC - date.getTime();
}

// Today's Zagreb calendar date.
const now = new Date();
const todayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const [y, m, d] = todayFmt.format(now).split('-').map(Number);

// Convert a local Zagreb wall-clock (today) to unix-ms.
function localToMs(hour, minute) {
  // Provisional: treat the wall-clock as if it were UTC, then subtract the
  // offset that applies near that instant (offset is stable across a single day
  // except across a DST boundary, which does not occur inside 08:00–20:00).
  const provisional = Date.UTC(y, m - 1, d, hour, minute, 0);
  const offset = zagrebOffsetMs(new Date(provisional));
  return provisional - offset;
}

const OPEN_MS = localToMs(OPEN_HOUR, 0);
const CLOSE_MS = localToMs(CLOSE_HOUR, 0);

// ---------------------------------------------------------------------------
// Concurrency timeline — running load per instant, enforcing <= FLEET.
//
// We track load as a sorted array of (timeMs, delta) events and, before placing
// a booking, verify that adding its `quantity` over [start, end) never pushes
// the instantaneous concurrency above FLEET.
// ---------------------------------------------------------------------------
const events = []; // { t, delta }

// Compute the max concurrency over an interval IF we were to add `qty`.
function maxConcurrencyIfAdded(start, end, qty) {
  // Collect all distinct event boundaries within [start, end), plus start.
  const candidate = [...events, { t: start, delta: qty }, { t: end, delta: -qty }];
  candidate.sort((a, b) => a.t - b.t || a.delta - b.delta);
  let running = 0;
  let peak = 0;
  for (const e of candidate) {
    running += e.delta;
    if (running > peak) peak = running;
  }
  return peak;
}

// `cap` is a soft ceiling (defaults to the hard FLEET limit). It lets non-peak
// hours stay below 8 so the day has a real midday peak with morning/evening
// taper. The hard FLEET ceiling is ALWAYS enforced — cap can only be stricter.
function tryPlace(start, end, qty, cap = FLEET) {
  const ceiling = Math.min(cap, FLEET);
  if (maxConcurrencyIfAdded(start, end, qty) > ceiling) return false;
  events.push({ t: start, delta: qty });
  events.push({ t: end, delta: -qty });
  return true;
}

// Final timeline stats (after all placements).
function timelineStats() {
  const sorted = [...events].sort((a, b) => a.t - b.t || a.delta - b.delta);
  let running = 0;
  let peak = 0;
  // hourly peak buckets across the operating window
  const hourlyPeak = new Map(); // hour -> peak concurrency observed in that hour
  // Walk segments between consecutive event times.
  for (let i = 0; i < sorted.length; i++) {
    running += sorted[i].delta;
    if (running > peak) peak = running;
    const segStart = sorted[i].t;
    const segEnd = i + 1 < sorted.length ? sorted[i + 1].t : segStart;
    if (segEnd > segStart && running > 0) {
      // Attribute this segment's load to each local hour it spans.
      const startHour = hourOf(segStart);
      const endHour = hourOf(segEnd - 1);
      for (let h = startHour; h <= endHour; h++) {
        hourlyPeak.set(h, Math.max(hourlyPeak.get(h) ?? 0, running));
      }
    }
  }
  let busiestHour = OPEN_HOUR;
  let busiestVal = -1;
  for (const [h, v] of hourlyPeak) {
    if (v > busiestVal || (v === busiestVal && h < busiestHour)) {
      busiestVal = v;
      busiestHour = h;
    }
  }
  return { peak, busiestHour, busiestVal };
}

function hourOf(ms) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour12: false,
    hour: '2-digit',
  });
  const h = dtf.format(new Date(ms));
  return h === '24' ? 0 : +h;
}

// ---------------------------------------------------------------------------
// Croatian renter names / group labels + occasional notes.
// ---------------------------------------------------------------------------
const NAMES = [
  'Marko', 'Ivan', 'Ana', 'Petra', 'Luka', 'Ivana', 'Josip', 'Marija',
  'Tomislav', 'Nikolina', 'Filip', 'Dora', 'Matej', 'Lucija', 'Karlo',
  'grupa 4', 'grupa 3', 'crveni kombi', 'plavi kombi', 'obitelj Horvat',
  'obitelj Kovačević', 'hostel Riva', 'turisti DE', 'turisti IT',
];
const NOTES = [
  null, null, null, null, // mostly no note
  'Treba kacige', 'Plaćeno unaprijed', 'Kasni 10 min', 'Produžetak moguć',
  'Grupna rezervacija', 'Traži automatik', 'Povratak do 20h', 'Depozit uzet',
];

// Desired concurrency shape by hour (target peak load) — morning/evening taper,
// midday peak. Used to drive how aggressively we attempt placements per hour.
const HOUR_TARGET = {
  8: 3, 9: 4, 10: 5, 11: 7, 12: 8, 13: 8, 14: 8, 15: 7, 16: 6, 17: 5, 18: 4, 19: 3,
};

// ---------------------------------------------------------------------------
// Build rows.
// ---------------------------------------------------------------------------
const rows = [];
const nowMs = Date.now();

function addReservation(start, end, qty) {
  const durationMin = Math.round((end - start) / 60000);
  rows.push({
    id: nanoid(12),
    quantity: qty,
    start_time: start,
    end_time: end,
    duration_min: durationMin,
    renter_name: pick(NAMES),
    notes: pick(NOTES),
    status: 'reserved',
    kind: 'reservation',
    created_at: nowMs,
    updated_at: nowMs,
  });
}

// 1) Place 1–2 maintenance blocks first so they consume fleet capacity that
//    reservations must work around.
const maintenanceBlocks = [
  // mid-morning 1h block, 1 unit down
  { startH: 10, startM: 0, durMin: 60, qty: 1, note: 'Skuter — kvar' },
  // early-afternoon 2h block, 2 units down for service
  { startH: 14, startM: 30, durMin: 120, qty: 2, note: 'Servis — redovni' },
];
let maintenanceCount = 0;
for (const mb of maintenanceBlocks) {
  const start = localToMs(mb.startH, mb.startM);
  const end = start + mb.durMin * 60000;
  if (tryPlace(start, end, mb.qty)) {
    rows.push({
      id: nanoid(12),
      quantity: mb.qty,
      start_time: start,
      end_time: end,
      duration_min: mb.durMin,
      renter_name: null,
      notes: mb.note,
      status: 'reserved', // status stays in the allowed set; kind marks it as maintenance
      kind: 'maintenance',
      created_at: nowMs,
      updated_at: nowMs,
    });
    maintenanceCount++;
  }
}

// 2) Concurrency-driven fill. For each hour we measure the ACTUAL concurrency
//    already present at the hour's mid-point and keep adding bookings until that
//    hour reaches its HOUR_TARGET (the desired midday-peak / morning-evening-
//    taper shape). Quantity is biased by hour: midday gets the larger (qty 3–4)
//    bookings that build the peak; off-peak hours get small (qty 1–2) bookings.
//    tryPlace's hard FLEET ceiling guarantees the timeline never breaches 8 and
//    its soft `cap` keeps each hour at/below its target so the shape holds.
let attempts = 0;
let placed = 0;
const MAX_ATTEMPTS = 6000;
// Aim for the middle of the 30–45 band rather than the floor.
const TARGET_RESERVATIONS = 40;

// Sample the current peak concurrency within an hour [hour:00, hour+1:00).
function hourPeak(hour) {
  const lo = localToMs(hour, 0);
  const hi = localToMs(hour, 0) + 3600000;
  const sorted = [...events].sort((a, b) => a.t - b.t || a.delta - b.delta);
  let running = 0;
  let peak = 0;
  for (const e of sorted) {
    running += e.delta;
    if (e.t >= lo && e.t < hi && running > peak) peak = running;
    // also capture load carried into the hour from earlier bookings
    if (e.t < lo && running > peak && lo < hi) peak = Math.max(peak, running);
  }
  // Account for load active at the hour boundary itself.
  let atLo = 0;
  for (const e of sorted) if (e.t <= lo) atLo += e.delta;
  return Math.max(peak >= 0 ? peak : 0, atLo);
}

// Quantity distribution by hour. Favour smaller groups so the same concurrency
// target is reached with MORE individual bookings — a real busy rental day is
// many small (1–2 unit) rentals plus the occasional larger group. Midday still
// sees more of the qty 3–4 groups that visibly build the peak.
function qtyForHour(hour) {
  const target = HOUR_TARGET[hour] ?? 2;
  if (target >= 7) return pick([1, 2, 2, 2, 3, 4]); // peak: mostly small, a few big groups
  if (target >= 5) return pick([1, 1, 2, 2, 3]);
  return pick([1, 1, 1, 2]); // off-peak: small fillers
}

for (let pass = 0; pass < 14 && placed < TARGET_RESERVATIONS; pass++) {
  for (let hour = OPEN_HOUR; hour < CLOSE_HOUR; hour++) {
    const cap = HOUR_TARGET[hour] ?? 2; // soft per-hour ceiling (<= 8)
    // Keep adding into this hour until it reaches its target concurrency.
    let guard = 0;
    while (hourPeak(hour) < cap && placed < TARGET_RESERVATIONS && guard < 40) {
      guard++;
      attempts++;
      if (attempts >= MAX_ATTEMPTS) break;
      const minute = randint(0, 11) * 5; // 5-minute marks
      const start = localToMs(hour, minute);
      const dur = pick(DURATIONS);
      const end = start + dur * 60000;
      if (end > CLOSE_MS) continue;
      const qty = qtyForHour(hour);
      if (!tryPlace(start, end, qty, cap)) continue;
      addReservation(start, end, qty);
      placed++;
    }
  }
}

// 3) Future-tail bias — if the current Zagreb time is still inside the operating
//    window, deliberately ensure a handful of reservations START after "now"
//    (clamped to the 20:00 close) so the board shows a visible past/future and
//    read-only/editable split. Honest no-op when the window is nearly over.
const futureWindowStart = Math.max(nowMs, OPEN_MS);
const hasFutureRoom = futureWindowStart < CLOSE_MS - 25 * 60000; // >=25min left
let futurePlaced = rows.filter((r) => r.start_time > nowMs && r.kind === 'reservation').length;
let futureAttempts = 0;
if (hasFutureRoom) {
  while (futurePlaced < 6 && futureAttempts < 600) {
    futureAttempts++;
    const slotsLeft = Math.floor((CLOSE_MS - futureWindowStart) / (5 * 60000));
    if (slotsLeft <= 0) break;
    const raw = futureWindowStart + randint(1, Math.max(1, slotsLeft - 1)) * 5 * 60000;
    const startOn5 = raw - (raw % (5 * 60000)); // snap to 5-min mark
    const dur = pick(DURATIONS);
    const end = startOn5 + dur * 60000;
    if (end > CLOSE_MS || startOn5 <= nowMs) continue;
    const cap = HOUR_TARGET[hourOf(startOn5)] ?? 4;
    const qty = pick([1, 1, 2, 3]);
    if (tryPlace(startOn5, end, qty, cap)) {
      addReservation(startOn5, end, qty);
      placed++;
      futurePlaced++;
    }
  }
}

// 4) Top-up — fill any remaining capacity toward the middle of the 30–45 band
//    with small (qty 1–2) bookings, honouring each hour's soft cap so the
//    midday-peak shape is preserved while gaps in off-peak hours fill in.
let topupAttempts = 0;
while (placed < TARGET_RESERVATIONS && topupAttempts < 4000) {
  topupAttempts++;
  const hour = randint(OPEN_HOUR, CLOSE_HOUR - 1);
  const minute = randint(0, 11) * 5;
  const start = localToMs(hour, minute);
  const dur = pick(DURATIONS);
  const end = start + dur * 60000;
  if (end > CLOSE_MS) continue;
  const cap = HOUR_TARGET[hour] ?? 2;
  const qty = pick([1, 1, 1, 2]);
  if (tryPlace(start, end, qty, cap)) {
    addReservation(start, end, qty);
    placed++;
  }
}

// ---------------------------------------------------------------------------
// Persist (PostgreSQL via node-postgres `pg`).
// ---------------------------------------------------------------------------
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('[dev-seed] ERROR: DATABASE_URL is not set.');
  console.error('[dev-seed]   Export it first, e.g.:');
  console.error("[dev-seed]   export $(grep -v '^#' infra/.env | xargs) && pnpm seed");
  console.error('[dev-seed]   (host-facing URL — host localhost + the mapped Postgres port)');
  process.exit(1);
}

const client = new pg.Client({ connectionString });

try {
  await client.connect();

  // Table-exists check — the Postgres equivalent of the old sqlite_master probe.
  // to_regclass returns NULL when the relation is absent, a regclass OID when present.
  const { rows: existsRows } = await client.query(
    "SELECT to_regclass('public.bookings') AS reg",
  );
  if (!existsRows[0] || existsRows[0].reg === null) {
    console.error('[dev-seed] ERROR: bookings table missing. Run migrations first:');
    console.error("[dev-seed]   export $(grep -v '^#' infra/.env | xargs) && pnpm db:migrate");
    await client.end();
    process.exit(1);
  }

  // Idempotency: clear first so re-runs produce the same packed day (no dupes),
  // then bulk-insert inside a single transaction. timestamptz columns receive
  // JS Date objects — node-postgres serializes Date → timestamp with time zone.
  await client.query('BEGIN');
  await client.query('DELETE FROM bookings;');
  const insertSql = `
    INSERT INTO bookings
      (id, quantity, start_time, end_time, duration_min, renter_name, notes, status, kind, created_at, updated_at)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  `;
  for (const r of rows) {
    await client.query(insertSql, [
      r.id,
      r.quantity,
      new Date(r.start_time), // ms → Date → timestamptz
      new Date(r.end_time),
      r.duration_min,
      r.renter_name,
      r.notes,
      r.status,
      r.kind,
      new Date(r.created_at),
      new Date(r.updated_at),
    ]);
  }
  await client.query('COMMIT');
} catch (err) {
  // Best-effort rollback so a partial insert never leaves a half-packed day.
  try {
    await client.query('ROLLBACK');
  } catch {
    // connection may already be gone — nothing to roll back
  }
  console.error('[dev-seed] ERROR while seeding:', err.message);
  await client.end();
  process.exit(1);
}

await client.end();

// ---------------------------------------------------------------------------
// Summary.
// ---------------------------------------------------------------------------
const reservationCount = rows.filter((r) => r.kind === 'reservation').length;
const maintCount = rows.filter((r) => r.kind === 'maintenance').length;
// Past vs future judged by start_time relative to "now" (reservations only —
// maintenance is reported separately so the split reads cleanly).
const resvRows = rows.filter((r) => r.kind === 'reservation');
const pastCount = resvRows.filter((r) => r.start_time <= nowMs).length;
const futureCount = resvRows.filter((r) => r.start_time > nowMs).length;
const ongoingCount = resvRows.filter((r) => r.start_time <= nowMs && r.end_time > nowMs).length;
const stats = timelineStats();

const nowFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hour12: false, hour: '2-digit', minute: '2-digit',
}).format(now);

const hh = (h) => `${String(h).padStart(2, '0')}:00`;
console.log('────────────────────────────────────────────────────────');
console.log(`[dev-seed] packed day seeded → PostgreSQL (DATABASE_URL)`);
console.log(`[dev-seed] Zagreb date:       ${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}  (now ${nowFmt} Zagreb)`);
console.log(`[dev-seed] window:            ${hh(OPEN_HOUR)}–${hh(CLOSE_HOUR)} (fleet ${FLEET})`);
console.log(`[dev-seed] reservations:      ${reservationCount}  (past ${pastCount}, ongoing ${ongoingCount}, future ${futureCount})`);
console.log(`[dev-seed] maintenance:       ${maintCount}`);
console.log(`[dev-seed] total rows:        ${rows.length}`);
console.log(`[dev-seed] peak concurrency:  ${stats.peak} / ${FLEET}`);
console.log(`[dev-seed] busiest hour:      ${hh(stats.busiestHour)}  (concurrency ${stats.busiestVal})`);
if (!hasFutureRoom) {
  console.log(`[dev-seed] note:              it is ${nowFmt} Zagreb — the ${hh(OPEN_HOUR)}–${hh(CLOSE_HOUR)} window is nearly/already over,`);
  console.log(`[dev-seed]                    so the packed day is mostly PAST. Re-run earlier in the day for a past/future mix.`);
}
console.log('────────────────────────────────────────────────────────');
if (stats.peak > FLEET) {
  console.error(`[dev-seed] INVARIANT BREACH: peak ${stats.peak} > fleet ${FLEET}`);
  process.exit(1);
}
