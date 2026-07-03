// =============================================================================
// Reservation Planning Board — root page
// =============================================================================
//
// No per-user auth gate: the Board has no user accounts (SPEC DEC-P1 /
// Decision #1). Per-principal session lookup, redirect('/login'), and
// buildAbility are deliberately absent — intentional, documented deviation
// from the standard nexus auth gate pattern (nexus-rules.md §2).
//
// A coarse app-wide shared-password gate now sits above the entire app in
// middleware.ts (SPEC DEC-AG1). That gate redirects unauthenticated visitors
// to /login before reaching this page. DEC-P1 still holds: there are no user
// accounts, no principals, and no per-booking authorization.
// @nucleus-skip-tier1: cache-decl — export const dynamic declared below
//
// Cache strategy: force-dynamic + revalidate = 0.
// The board reflects "now" — caching a snapshot would show stale bookings
// (SPEC DEC-P2, DEC-P4, DEC-P7).
//
// Day parameter: ?day=YYYY-MM-DD (Europe/Zagreb). Missing/invalid → today.
// Fine parameter: ?fine=1 → 5-minute density buckets; default = 15 minutes.
// These bucket sizes mirror domain/config.ts DENSITY_BUCKET_MIN_FINE /
// DENSITY_BUCKET_MIN_DEFAULT (DEC-P4). Kept here as app-layer literals so
// page.tsx stays within the allowed import boundary (ddd-architecture §3).
// =============================================================================

import { getDayBoard } from '@/modules/bookings/application/getDayBoardUseCase';
import {
  parseDayParam,
  formatDayParam,
  addDays,
} from '@/lib/time';
import { BoardView } from './_components/BoardView/BoardView';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Mirror of domain/config.ts DENSITY_BUCKET_MIN_* values — kept at the
// app-layer boundary so we avoid importing from domain/config directly.
const BUCKET_MIN_DEFAULT = 15;
const BUCKET_MIN_FINE = 5;

type SearchParams = {
  day?: string;
  fine?: string;
};

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // No auth step: see top-of-file comment.

  // 1. URL parameters — searchParams is a Promise in Next.js 15+
  const params = await searchParams;
  const now = new Date();

  const day = parseDayParam(params.day, now);
  const fine = params.fine === '1';
  const bucketMin = fine ? BUCKET_MIN_FINE : BUCKET_MIN_DEFAULT;

  // Pre-compute day-nav params so frankie's BoardView can build hrefs without
  // any date math — it receives ready-to-use strings (DEC-P2).
  const dayParam = formatDayParam(day);
  const prevDayParam = formatDayParam(addDays(day, -1));
  const nextDayParam = formatDayParam(addDays(day, 1));
  const todayParam = formatDayParam(now);
  const isToday = dayParam === todayParam;

  // 2. Data fetch — Promise.all wrapper even for a single fetch keeps the
  //    shape consistent when a parallel slow-fetch is added later (nexus-rules §4).
  const [boardResult] = await Promise.all([
    getDayBoard({ day, bucketMin }),
  ]);

  // Unexpected infrastructure failure (DB down, schema mismatch) → error.tsx.
  // Expected-missing doesn't apply: the board always returns data, even when
  // the day has zero bookings.
  if (!boardResult.success) {
    throw new Error(boardResult.error.message);
  }

  const board = boardResult.value;

  // 3. Delegate to frankie — prop contract documented in HANDOFF.yaml.
  //    BoardView prop name changes: `snapshot` → `board` (DEC-P8 rename restraint
  //    applies to the module; the prop is a UI concern and is updated here).
  return (
    <BoardView
      board={board}
      fine={fine}
      dayParam={dayParam}
      prevDayParam={prevDayParam}
      nextDayParam={nextDayParam}
      todayParam={todayParam}
      isToday={isToday}
    />
  );
}
