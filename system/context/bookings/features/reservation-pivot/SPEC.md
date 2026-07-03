<!--
SPEC.md — working memory for one change-unit.

Lives at: system/context/bookings/features/reservation-pivot/SPEC.md

This change-unit is a MAJOR PRODUCT PIVOT of the existing bookings module
(see sibling SPEC at ../booth-board/SPEC.md). The booth-board SPEC remains the
historical record of the "send-out lifecycle board" that shipped first; this
SPEC supersedes it for everything DEC-P1..DEC-P9 touch. DEC-A (the sacred
availability engine) is explicitly carried forward, not replaced — see DEC-P9.

Original FSD source of truth: /FSD.md. The pivot deliberately OVERRIDES several
FSD §6 locks and §15 non-goals; each override is named in the relevant DEC-P.
-->

---
id: bookings-reservation-pivot
slug: reservation-pivot
module: bookings
type: feature
state: working
created: 2026-06-25
updated: 2026-07-03
---

<!-- AUTO:CARD — overwritten by the auditor on every run -->
## CARD — engineering review · 2026-07-03T00:00:00Z (fleet-const bugfix)
**verdict** PASS with notes

**Changed files** 3
app/_components/AvailabilityHeader/AvailabilityHeader.tsx
app/_components/DensityChart/DensityChart.tsx
app/_components/UtilizationPanel/UtilizationPanel.tsx

**Findings** none · none · 1 note

### architecture — architecture.md
**Notes**
- app/_components/**  `FLEET = 6` now duplicated across 3 UI files + domain + schema — deliberate (app→domain boundary), documented, at the §9 three-use threshold. Awareness only. (§9)

Everything else clean:
- §8 no half-finished work — this diff COMPLETES the 8→6 migration (DEC-P10); domain FLEET_SIZE=6 and schema quantity 1..6 already updated, these 3 lagging UI constants were the tail. Closes the gap, adds none.
- §10 code is communication — each `const FLEET = 6` carries a why-comment (DEC-P10 source + app→domain boundary rationale). Stale JSDoc/comments corrected in lockstep; no stale headers remain.
- react-components §4 — all three pure `_components/`: props → JSX, zero hooks, no state.
- server-first-react — all three Server Components; no `'use client'`, no client surface added.
- frankie-rules §2.1/§5/§6 — no JSX/styling/props changed; `aria-label` strings embedding `${FLEET}` now correctly announce "od 6"; a11y fixed alongside visual. Semantic tokens/HTML intact.
- project-structure §4 / ddd §3 — components import only `domain/types` (public); correctly do NOT import `domain/config`. One-way boundary respected.

<!-- /AUTO:CARD -->

## Intent

The client has responded to the shipped booth-board with a new product direction. The booth-board was built as a **same-day send-out lifecycle board**: an operator created a booking, physically "sent out" the skis, recorded partial/full returns, and watched late/at-risk/no-show flags. Availability was inferred partly from that lifecycle. The client now wants something materially different: a **reservation-density planning board** where **the reservation itself is the sole source of truth for all availability**, the "out" handout step disappears entirely, and the operator plans across days — not just today.

The pivot reframes the product from "track skis as they go out and come back" to "plan the day's reservations for maximum, accurate fleet utilization." The single question the operator answers under pressure stays the same — *"can I rent N scooters at time T for D minutes?"* — but the board now also proactively offers the **first possible slot** for a desired selection, visualizes the day's reservation **density** like Google Maps "popular times," lets the operator **block scooters for maintenance** (which counts against availability), proposes a **minimal-change reconciliation** when reality slips (a late party, a malfunctioning scooter), and reports a **daily utilization percentage** so the owner can see how hard the fleet worked. The product also gains a brutally simple **day switcher**: past reservations are read-only, future reservations can be created and edited.

North star (unchanged from the booth-board, sharpened here): **brutal simplicity and field-grade usability, sitting on top of brutally accurate data the business depends on.** Idle scooters waste money; over-commitment burns trust at the booth. The board exists to make the high-utilization, never-over-committed plan obvious and instant, while keeping the human in charge — the algorithm proposes, the operator decides.

## Scope

**In**

Lifecycle & data model:
- Collapse `BookingStatus` to `'reserved' | 'cancelled'`; remove the entire send-out / return / partial-return machinery and the standalone Extend action. A reservation occupies its scheduled window `[startTime, endTime)` and that window is the only fact availability needs. (DEC-P1)
- Add a `kind: 'reservation' | 'maintenance'` discriminator so a maintenance block consumes scooters on the same unified timeline as a reservation. (DEC-P3)

Multi-day planning:
- Day-scope the board via a `?day=YYYY-MM-DD` param (Europe/Zagreb), default today, with brutally simple Prev / Today / Next navigation. Past/in-progress reservations are read-only; only strictly-future reservations are creatable/editable/cancellable (reconciliation is the sole exception path). (DEC-P2)

Planning views & flows:
- A reservation **density view** — a popular-times-style bar chart of committed scooters across the day in 5- or 15-minute buckets (default 15, toggle to 5). (DEC-P4)
- A **slot finder** creation flow: operator picks quantity + duration + desired time; the UI shows the FIRST possible slot plus other open slots for that quantity/duration on the day. (DEC-P5)
- **Maintenance blocking**: mark N scooters unavailable for a window; that unavailability reduces availability across the window and appears in the density chart. (DEC-P3, DEC-P4)
- **Reconciliation**: operator marks a disruption (a reservation running late, a scooter malfunction reducing capacity until T); the system computes the MINIMAL set of reservation changes to restore a feasible order and presents it as a proposal the human applies — never auto-applies. (DEC-P6)
- **Daily utilization review**: a per-day utilization percentage plus peak-concurrent, busiest-hour, idle, and maintenance metrics. (DEC-P7)

Engine:
- All new computations are pure functions living in (or beside) `domain/availability.ts`, which remains the single source of truth for every fit check. `now`, `fleet`, and the operating window are passed in; no clock reads inside. (DEC-P9)

**Out** — not in this change-unit.

Deliberately overridden FSD items (now superseded — see Decisions for the governing DEC-P):
- FSD §8 send-out lifecycle, FR-8 / FR-9 / FR-10 / FR-14..FR-17 (out/returned/dispatch/partial-return/late/at-risk/no-show in their old "out"-based form) — superseded by DEC-P1.
- FSD §6 "same-day only" and §15 "no multi-day calendar / future dates" — superseded (narrowly) by DEC-P2.
- FSD §15 "no maintenance management" — superseded (narrowly, capacity-blocking only) by DEC-P3.
- FSD §4 non-goal "not an optimiser / never auto-reschedules" — narrowed by DEC-P6 to "proposes a minimal change, never auto-applies."

Still out of scope (carried from booth-board, unchanged):
- No authentication, no Principal, no tenant, no policy. The Nucleus `@core/auth` / `@core/identity` / `@core/iam` packages remain installed but unused.
- No realtime transport (WebSocket / SSE / Pusher). Sync stays polling-based via `router.refresh()` (~2s).
- No pricing, payments, deposits, invoices. No customer accounts or customer-facing booking. No notifications of any kind.
- No assignment of specific physical machines (capacity model only; FSD §6 "capacity, not assignment" still holds — machine labels remain a future enhancement).
- No fleet maintenance management beyond capacity-blocking (no fuel logs, service schedules, parts) — DEC-P3 is scoped strictly to "this many scooters are unavailable for this window."
- No fuel, staff, or multi-location management. No client-facing administration or settings screen.
- Module rename: the internal module stays `bookings` and the type stays `Booking` — deliberately not renamed. (DEC-P8)

## Decisions

<!--
Pivot decisions, recorded in the DEC-style of the sibling booth-board SPEC
(DEC-A..DEC-F). Each names the FSD lock / non-goal it deliberately overrides.
DEC-A from booth-board is carried forward verbatim-in-spirit as DEC-P9.
-->

1. **DEC-P1 — Lifecycle collapse: the reservation is the sole source of truth.** `BookingStatus` becomes `'reserved' | 'cancelled'`. Removed: the `'out'` and `'returned'` statuses, `dispatchedAt`, `returnedCount`, partial returns, the **Send out** action, and the standalone **Extend** action (extend folds into editing a future reservation's duration). A reservation occupies its scheduled window `[startTime, endTime)` and that window is the only fact availability needs to compute everything. The late / at-risk / no-show machinery in its old "out"-based form is removed — lateness re-enters the system only as a *reconciliation disruption* (DEC-P6), not as a per-row "out and overdue" flag. **Rejected:** keeping the lifecycle and layering reservations on top (two sources of truth for "what's committed," guaranteed drift); a soft "checked-in" boolean (reintroduces the handout step the client explicitly killed). **Why:** the client's verbatim ask #1 — sending a scooter "out" is no longer relevant; the reservation must be the single truth for all availability computation. One timeline, one fact, zero lifecycle drift. **Overrides** FSD §8 lifecycle and FR-8 / FR-9 / FR-10 / FR-14..FR-17.

2. **DEC-P2 — Multi-day, day-scoped via a URL param; past is read-only.** The board is scoped to one day via `?day=YYYY-MM-DD` (Europe/Zagreb), defaulting to today, with brutally simple **Prev / Today / Next** navigation (≤1 tap each direction). A reservation is editable / cancellable only if its start is strictly in the future relative to `now`; past and in-progress reservations are read-only. Reconciliation (DEC-P6) is the only path that may touch a non-future reservation, and only via an explicit operator-applied proposal. The repository's `findToday` day-range read generalizes to a `findByDay(dayStart, dayEnd)` range query. **Rejected:** a full multi-day calendar / week view (violates the favour-grade simplicity ceiling and the client asked for a *brutally simple* day switcher, not a calendar); making past reservations freely editable (corrupts the historical utilization record the daily review depends on). **Why:** the client's verbatim ask #2 — show reservations for a particular day; future editable, past immutable, switcher brutally simple. **Overrides** FSD §6 "same-day only" and FSD §15 "no multi-day calendar / future dates" — narrowed to a single-day-at-a-time switcher, not a calendar engine.

3. **DEC-P3 — Maintenance blocks via a `kind` discriminator on one unified timeline.** Add `kind: 'reservation' | 'maintenance'` to the bookings table (default `'reservation'`). A maintenance block consumes `quantity` scooters for `[start, end)` exactly like a reservation in the availability math — one unified timeline, minimal new infrastructure, brutally accurate. Both reservations and maintenance reduce availability; utilization (DEC-P7) counts only reservations as revenue-bearing while maintenance *reduces the capacity denominator* rather than contributing to the reserved numerator. **Rejected:** a separate `maintenance_blocks` table (a second timeline the availability engine would have to merge — exactly the drift DEC-P1 exists to prevent); a per-scooter "unavailable" flag (the product is capacity-model, not machine-assignment — FSD §6 still holds). **Why:** the client's verbatim ask #4 — remove a scooter from a timeslot for malfunction/maintenance and have it count against availability. A discriminator on the existing record reuses every pure fit function unchanged. **Overrides** FSD §15 "no maintenance management" — narrowed strictly to capacity-blocking, NOT fleet maintenance management (no fuel/service/parts tracking).

4. **DEC-P4 — Density profile is a new pure domain function.** Add `densityProfile(records, dayStart, dayEnd, bucketMin)` to the domain layer, returning ordered buckets of committed-scooter counts across the day (splitting reservation vs maintenance counts per bucket if cheap to do so). Bucket size is 5 or 15 minutes, default 15 with a toggle to 5. This powers the popular-times-style chart. **Rejected:** computing the chart in the UI layer (would duplicate commitment math outside the domain, violating DEC-P9 / DEC-A); continuous integration of an interval tree (premature — buckets are exact enough for a 12-hour day and trivially correct). **Why:** the client's verbatim ask #3 — a reservation density view in 5/15-minute buckets. Promotes FSD §17.3 (day timeline) from a deferred future enhancement to in-scope.

5. **DEC-P5 — Slot finder generalizes `nextOpening` into `openSlots`.** Generalize the existing pure `nextOpening` into `openSlots(records, quantity, durationMin, fromTime, dayEnd, maxResults)`, returning an ordered list of feasible start times for the requested quantity + duration on the day; the first element is the "first possible slot." Earliest-first ordering naturally packs the day for utilization. This powers the creation flow's "first possible slot + other open slots." **Rejected:** a bespoke search separate from `nextOpening` (two implementations of the same feasibility walk — guaranteed to disagree at the boundary handoff R-AVAIL-3); returning a single slot only (the client explicitly wants the first PLUS other open slots). **Why:** the client's verbatim ask #6 — operator picks quantity + duration + desired time and sees the first possible slot plus other open slots that day. One feasibility walk, reused, ordered for packing.

6. **DEC-P6 — Reconciliation optimizer: pure, proposal-only, minimal change.** The operator marks a disruption (a reservation running late by X minutes, or a scooter malfunction reducing capacity from now until time T). A pure function `reconcile(records, disruption, now, fleet)` returns the MINIMAL proposal — the fewest reservations shifted by the least total delay. The algorithm is greedy: process affected upcoming reservations earliest-first, push each to its earliest feasible start, re-check downstream, repeat until feasible. The human reviews the proposal and applies it explicitly; the system NEVER auto-reschedules. **Rejected:** a true optimal-assignment solver (ILP / min-cost flow — vast overkill for a 6-scooter, single-day, favour-grade board, and the greedy minimal-delay packing is what an operator would do by hand anyway); auto-applying the proposal (directly violates "human in charge"). **Why:** the client's verbatim ask #5 — on a failure or a late party, find the minimal set of reservation changes to restore a feasible running order. **Overrides** FSD §4 non-goal "not an optimiser / never auto-reschedules" — narrowed to "proposes a minimal change, never auto-applies." FSD §6 "human in charge" is preserved exactly: the proposal is inert until the operator applies it.

7. **DEC-P7 — Daily utilization review is a pure report function.** Add `utilizationReport(records, dayStart, dayEnd, fleet, now)` returning `{ utilizationPct, reservedScooterMinutes, capacityMinutes, peakConcurrent, busiestHour, reservationCount, maintenanceMinutes, idleScooterMinutes }`. Utilization % = `reservedScooterMinutes / (fleet × operatingWindowMinutes − maintenanceMinutes)` — maintenance reduces the denominator, reservations fill the numerator. The operating window is a config constant (default 08:00–20:00 Europe/Zagreb). **Rejected:** counting full calendar-day minutes as the denominator (would understate utilization with a fleet idle overnight that nobody expects to be working); a UI-side aggregation (duplicates commitment math outside the domain). **Why:** the client's verbatim ask #7 — ruthless utilization optimization plus a daily review with a utilization percentage. Promotes FSD §17.2 (daily report) from a deferred future enhancement to in-scope and makes it utilization-centric.

8. **DEC-P8 — Naming restraint: keep `bookings` / `Booking` internally.** The internal module name stays `bookings` and the domain type stays `Booking`, to avoid gratuitous churn across schema, repositories, use cases, server actions, and imports. "Reservation" is the user-facing term only — the Croatian UI already reads "Rezervirano." The unit noun ("scooter" vs "jet ski") is a UI-string concern, low priority, handled opportunistically. **Rejected:** renaming the module to `reservations` (a large mechanical diff touching every layer and every import path, for zero behavioral gain — architecture.md §12 pragmatism / §13 maintainability both argue against the churn). **Why:** the value is in the behavior change, not the noun; keep the diff focused on what the client actually asked for.

9. **DEC-P9 — The sacred availability core is preserved (carries DEC-A forward).** Booth-board DEC-A still holds in full: `modules/bookings/domain/availability.ts` remains the single source of truth for every fit check in the system. Every new pure function (`densityProfile`, `openSlots`, `reconcile`, `utilizationReport`) lives there or directly beside it and is built on the existing primitives (`effectiveWindow`, `commitmentAt`, `peakCommitment`, `fits`, `nextOpening`). The purity contract is non-negotiable: no `Date.now()` inside any of these — `now`, `fleet`, and the operating window are passed in; functions are deterministic and side-effect-free. The boundary-handoff rule **R-AVAIL-3** (a window ending at T does not conflict with one starting at T) is preserved exactly — it is the classic failure mode of these tools and the client's data correctness depends on it. No fit / commitment / density / slot / reconciliation math is duplicated in server actions, containers, components, or other use cases. **Why:** the board's entire trust value is that every device runs the same pure code and gets the same answer (FSD §13 M-4); the pivot expands what the engine computes but must not fork where the truth lives. Tagged against `architecture.md §3` (pure core / imperative shell) and `architecture.md §10` (code is communication).

<!-- 2026-07-03 — fleet size reduced from 8 to 6. This is the primary home for the fleet-size decision (see also the sibling booth-board / edit-maintenance SPECs, which had their 8-scooter references reconciled the same day). -->

10. **DEC-P10 — Fleet size is 6 scooters, not 8; the DB `quantity` CHECK is tightened to match.** `FLEET_SIZE` becomes `6` (was `8`) in `modules/bookings/domain/config.ts` — the fleet actually operating is six scooters, so every fit / density / slot-finder / reconciliation / utilization computation now caps at 6. The `bookings` table CHECK constraint `bookings_quantity_range` is tightened from `quantity BETWEEN 1 AND 8` to `1 AND 6` in `modules/bookings/schema/bookings.ts`, with a generated migration `modules/bookings/schema/migrations/0001_bitter_magneto.sql`. Because `FLEET_SIZE` is the single source of truth threaded into the pure engine (DEC-P9), no fit/density/slot/reconciliation/utilization math changes shape — only the ceiling drops. **Rejected:** loosening the CHECK to a permissive upper bound so historical rows never block a migration (an audit tool must reflect the real fleet — a `quantity=7` row is impossible under a 6-scooter operation and should be caught, not silently tolerated); keeping the CHECK at `1 AND 8` while only lowering `FLEET_SIZE` (the domain and the schema would then disagree — the app would refuse a 7-scooter booking that the database would happily store, exactly the domain/schema drift architecture.md §2 warns against). **Safety note / migration gate:** the tighten is data-incompatible with any existing row where `quantity > 6`. Deploy target is migrate-on-deploy against Neon and is **fail-closed by design** — a data-incompatible migration would block the deploy rather than corrupt data. Before the first deploy the operator runs `SELECT count(*) FROM bookings WHERE quantity > 6` against production: if the count is `0` the migration applies cleanly; if it is non-zero the operator resolves those rows first (the migration would otherwise fail-closed and halt the deploy). The migration is **generated but NOT yet applied**. Tagged against `architecture.md §2` (domain/schema must agree — the trust boundary) and `architecture.md §15` (risk management — the fail-closed migrate-on-deploy gate makes the data-incompatibility cheap to discover before it can bite). **Update (2026-07-03 — clean-slate confirmation; gate MOOT on first deploy):** the operator confirmed production has had **no migrations run yet — it is a clean slate**. The bookings migrations apply in order on the first deploy: `0000_blushing_multiple_man` CREATEs the `bookings` table with CHECK `BETWEEN 1 AND 8` against a brand-new (zero-row) table, then `0001_bitter_magneto` DROPs that CHECK and ADDs `BETWEEN 1 AND 6` — all before the app ever writes a row. Because the table is created empty and tightened in the same first-deploy migration pass, no row can violate `1..6`: the `ADD CONSTRAINT` validates against zero rows and trivially succeeds. The pre-deploy `SELECT count(*) FROM bookings WHERE quantity > 6` data-check is therefore **moot on first deploy** (it definitionally returns `0`); the tighten ships with **zero data risk**, and no `NOT VALID → VALIDATE` multi-step is needed. **The original gate text above is retained, not deleted** — it would still be the correct pre-flight check if this tighten were ever applied to a *populated* database later (e.g. re-run against an environment that already carries booking rows). For the initial deploy it is resolved/moot.

## Acceptance Criteria

<!--
Plain-English observable checks. Documentation of intent — the auditor does not
run them. The two regression criteria (AC-2) anchor the pivot to the FSD's
worked examples so the sacred engine's behavior is provably unchanged.
-->

- [ ] **AC-1 — Send-out removed.** No `'out'` or `'returned'` status exists anywhere; no `dispatchedAt` or `returnedCount` field exists; and no Send-out / Return / partial-return / Extend affordance appears anywhere in the UI. The reservation window is the only commitment fact.
- [ ] **AC-2 — Availability identical-math regression.** With 4 scooters 12:00–13:00 and 2 scooters 12:30–13:15 on the day, a request for 3 scooters 12:45–13:30 does NOT fit, and the first open slot reported is 13:00 (FSD worked example A). A reservation ending exactly at T does not block one starting at T (FSD worked example B, R-AVAIL-3) — the boundary handoff still holds after the pivot.
- [ ] **AC-3 — Day navigation.** The operator can switch to the previous or next day, or jump to today, in ≤1 tap each direction. Reservations whose start is in the past are read-only; reservations whose start is strictly in the future are creatable and editable.
- [ ] **AC-4 — Maintenance counts against availability.** Blocking N scooters for a window reduces computed availability by N across that window (a request that would otherwise fit no longer fits if it overlaps and pushes the total over fleet) and the blocked capacity is visible in the density chart.
- [ ] **AC-5 — Slot finder.** Selecting a quantity + duration + desired time yields the FIRST possible slot for that selection plus a list of subsequent open slots for that same quantity/duration on the day.
- [ ] **AC-6 — Reconciliation is a minimal, operator-applied proposal.** Marking a disruption (a late reservation or a capacity reduction) produces a proposal that shifts the fewest reservations by the least total delay to restore feasibility, and the proposal is applied only on explicit operator action — never automatically.
- [ ] **AC-7 — Density chart.** The board shows a popular-times-style bar chart of committed scooters across the day in 5- or 15-minute buckets, with a toggle between bucket sizes (default 15).
- [ ] **AC-8 — Utilization review.** The board shows a per-day utilization percentage plus peak-concurrent, busiest-hour, and idle metrics for the selected day.

## Tasks

<!--
Ordered by layer dependency so types/schema drive the diff downstream:
schema → module (domain + application) → server layer → UI → audit.
-->

- [ ] **T1 — Schema reshape** (owner: archie)
  Reshape the `bookings` table for the pivot. Produce a **Minimal Change Report** for user approval before any migration runs.
  - `status` enum → constrained to `'reserved' | 'cancelled'` (drop `'out'`, `'returned'`).
  - DROP `dispatched_at` and `returned_count` columns.
  - ADD `kind` enum column, default `'reservation'`, CHECK-constrained to `'reservation' | 'maintenance'` (DEC-P3).
  - Update CHECK constraints and indexes for day-range reads (`kind` + `status` + `start_time`).
  - Note: the local `data/board.db` uses lazy `CREATE TABLE IF NOT EXISTS` with no migration pipeline, so the existing local DB will not migrate in place — flag that a local DB reset is required and document it in the report. (DEC-P1, DEC-P2, DEC-P3)

- [ ] **T2 — Module reshape** (owner: donnie)
  Reshape `modules/bookings/` along the DDD layer cake. Keep Result types; preserve purity; capability sidecar for every use case.
  - `domain/availability.ts` (+ siblings) — preserve the existing primitives; add the new pure functions: `densityProfile(records, dayStart, dayEnd, bucketMin)` (DEC-P4), `openSlots(records, quantity, durationMin, fromTime, dayEnd, maxResults)` generalizing `nextOpening` (DEC-P5), `reconcile(records, disruption, now, fleet)` (DEC-P6), `utilizationReport(records, dayStart, dayEnd, fleet, now)` (DEC-P7). All pure, deterministic, `now`/`fleet`/operating-window passed in (DEC-P9). Preserve R-AVAIL-3 boundary handoff.
  - `domain/types.ts` — collapse `BookingStatus` to `'reserved' | 'cancelled'`; add `kind` discriminator; remove `dispatchedAt` / `returnedCount`; add disruption / slot / density / utilization result types. (DEC-P1, DEC-P3)
  - `infrastructure/repositories/DrizzleBookingRepository.ts` — replace `findToday` with a day-range query (`findByDay`); drop send-out/return write paths.
  - `application/` — remove `sendOutUseCase`, `returnSkisUseCase`, `extendBookingUseCase`. Reshape create/edit/cancel to be future-only (DEC-P2). Add: `blockScooterUseCase`, `cancelMaintenanceUseCase`, `computeOpenSlotsUseCase`, `proposeReconciliationUseCase`, `applyReconciliationUseCase`, `getDayBoardUseCase`, `computeUtilizationReportUseCase`. One factory per file, pre-wired instance exported, capability sidecar each (DEC-P9, project-structure §4).

- [ ] **T3 — Server layer** (owner: nexus)
  - `app/page.tsx` — read the `?day=YYYY-MM-DD` param (default today, Europe/Zagreb), fetch the day board via `getDayBoard`, pass raw data down, return `null` for frankie. Keep `force-dynamic`. (DEC-P2)
  - `app/actions.ts` — remove `sendOutAction`, `returnSkisAction`, `extendBookingAction`. Reshape `createBookingAction` / `editBookingAction` / `cancelBookingAction` to future-only with mapped errors. Add actions for `blockScooter`, `cancelMaintenance`, `computeOpenSlots`, `proposeReconciliation`, `applyReconciliation`. Each: presence-validate FormData, call one use case, `revalidatePath('/')`, return mapped error code. (DEC-P1, DEC-P3, DEC-P5, DEC-P6)
  - `app/loading.tsx` / `app/error.tsx` / `app/not-found.tsx` — skeleton updates as needed (return `null`; frankie fills).

- [ ] **T4 — UI** (owner: frankie)
  Replace nulls and reshape components. Croatian strings. Touches the UI shell only — every fit/density/slot/utilization computation routes through its server action → use case (DEC-P9); frankie never reimplements the math.
  - Day switcher (Prev / Today / Next), brutally simple (AC-3).
  - Density chart — popular-times-style bars, 5/15-min bucket toggle (AC-7).
  - Slot-finder results — first possible slot + subsequent open slots for the selection (AC-5).
  - Maintenance UI — block N scooters for a window; cancel a maintenance block (AC-4).
  - Reconciliation proposal panel — show the minimal proposal; apply only on explicit operator action (AC-6).
  - Utilization review panel — percentage + peak / busiest-hour / idle metrics (AC-8).
  - Reshape list / row / `StatusPill` for the `reserved | cancelled` + `reservation | maintenance` model; remove all send-out/return/extend affordances (AC-1).

- [ ] **T5 — Architectural review** (owner: auditor)
  Full pass over the change-unit against `architecture.md`, `project-structure.md`, `ddd-architecture.md`, `react-components.md`, `server-first-react.md`, `page-architecture.md`, `server-actions.md`, plus `archie-rules.md`, `donnie-rules.md`, `nexus-rules.md`, `frankie-rules.md`. Specific checks: DEC-P9 enforced (no fit/density/slot/reconciliation/utilization math duplicated outside `domain/availability.ts` and its siblings); R-AVAIL-3 boundary handoff preserved (AC-2); send-out lifecycle truly gone (no `'out'`/`'returned'`/`dispatchedAt`/`returnedCount` anywhere — AC-1); reconciliation never auto-applies (DEC-P6); all new pure functions take `now`/`fleet`/operating-window as parameters with no `Date.now()` inside.

## Change Log

<!-- ADD / MOD / DEL prefix; appended by implementing agents as work lands. -->

### 2026-06-25 — archie (T1 — Schema reshape)

- MOD `modules/bookings/schema/enums.ts` — collapsed `BOOKING_STATUS` to `['reserved','cancelled']` (DEC-P1); added `BOOKING_KIND = ['reservation','maintenance']` tuple + `BookingKind` type (DEC-P3). Rewrote the header rationale.
- MOD `modules/bookings/schema/bookings.ts` — removed the `returnedCount` and `dispatchedAt` Drizzle columns and their CHECK; added `kind` text column (`NOT NULL DEFAULT 'reservation'`, CHECK in `('reservation','maintenance')`); status CHECK now `('reserved','cancelled')`; replaced the `(status, start_time)` index with a single `(start_time)` day-range index `idx_bookings_start_time` (DEC-P2). `bookingsCreateTableSql` / `bookingsCreateIndexSql` export names unchanged so `infrastructure/database.ts` keeps compiling and bootstrapping (single `db.run` per string).
- MOD `modules/bookings/schema/index.ts` — barrel now re-exports `BOOKING_KIND` / `BookingKind`.
- Migration reality: no migration pipeline — `database.ts` uses lazy `CREATE TABLE IF NOT EXISTS`, so the existing gitignored `data/board.db` will NOT migrate in place. A local DB reset is required during verification (orchestrator owns the reset; `data/` untouched here).
- Downstream (`domain/types.ts`, repository, use cases, `app/`) still reference `returnedCount` / `dispatchedAt` / `'out'` / `'returned'` — expected; the module does not fully compile until T2/T3/T4 land.

### 2026-06-25 — donnie (T2 — Module reshape)

**domain/**
- MOD `domain/types.ts` — collapsed BookingStatus to 'reserved'|'cancelled'; added BookingKind; dropped dispatchedAt/returnedCount from Booking; added CreateMaintenanceInput; removed ReturnSkisInput/ExtendBookingInput; added DensityBucket, OpenSlotsResult, Disruption, ReconciliationChange, ReconciliationProposal, UtilizationReport, DayBoard (replaces BoardSnapshot); updated BookingError codes (added PAST_START, IMMUTABLE_PAST; removed INVALID_TRANSITION).
- MOD `domain/config.ts` — removed LATE_GRACE_MIN, NO_SHOW_GRACE_MIN, END_OF_DAY_LOCAL_HOUR; added OPERATING_DAY_START_HOUR, OPERATING_DAY_END_HOUR, DENSITY_BUCKET_MIN_DEFAULT, DENSITY_BUCKET_MIN_FINE; added operatingWindowStart(), operatingWindowEnd() pure helpers.
- MOD `domain/availability.ts` — full rewrite for reservation-pivot (DEC-P9): effectiveWindow simplified (no late-stretch); commitmentAt/peakCommitment no longer take `now` (no lifecycle); fits/freeNow/nextOpening updated accordingly; ADDED openSlots() (DEC-P5, generalizes nextOpening — nextOpening delegates to it); ADDED densityProfile() (DEC-P4); ADDED utilizationReport() (DEC-P7); ADDED reconcile() (DEC-P6, greedy proposal-only); REMOVED isLate, atRiskUpcoming, possibleNoShow.
- ADD `domain/booking.ts` — new file: pure domain predicate canCancel(booking, now) encapsulating cancel rules for reservation vs maintenance (DEC-P2, donnie-rules §6.1).
- MOD `domain/repository.ts` — replaced findToday→findByDay(dayStart,dayEnd); removed findAll (zero consumers).

**application/**
- MOD `createBookingUseCase.ts` — uses findByDay; status='reserved' (not 'booked'); kind='reservation'; enforces PAST_START (DEC-P2); no returnedCount/dispatchedAt.
- MOD `editBookingUseCase.ts` — enforces IMMUTABLE_PAST on past/started reservations (DEC-P2); enforces PAST_START when moving start; uses findByDay; removes returnedCount guard; removes INVALID_TRANSITION.
- MOD `cancelBookingUseCase.ts` — delegates to canCancel() pure fn (donnie-rules §6.1); handles both reservation and maintenance kinds.
- MOD `computeAvailabilityUseCase.ts` — uses findByDay; removes `now` threading to domain fns (no longer needed).
- DEL `sendOutUseCase.ts` + `.capability.ts` — DEC-P1: send-out lifecycle removed.
- DEL `returnSkisUseCase.ts` + `.capability.ts` — DEC-P1: return lifecycle removed.
- DEL `extendBookingUseCase.ts` + `.capability.ts` — DEC-P1: extend folds into editing a future reservation.
- DEL `getBoardSnapshotUseCase.ts` + `.capability.ts` — replaced by getDayBoardUseCase.
- DEL `listTodayUseCase.ts` + `.capability.ts` — replaced by getDayBoardUseCase.
- ADD `blockScooterUseCase.ts` + `.capability.ts` — creates maintenance blocks (kind='maintenance'); no fits() check (DEC-P3).
- ADD `getDayBoardUseCase.ts` + `.capability.ts` — primary board data source; computes DayBoard with density/utilization/freeNow (DEC-P2, DEC-P4, DEC-P7).
- ADD `computeOpenSlotsUseCase.ts` + `.capability.ts` — slot-finder query; calls openSlots() (DEC-P5).
- ADD `proposeReconciliationUseCase.ts` + `.capability.ts` — query: calls reconcile() pure fn; never writes (DEC-P6).
- ADD `applyReconciliationUseCase.ts` + `.capability.ts` — mutation: applies ReconciliationProposal changes; idempotent (DEC-P6).

**infrastructure/**
- MOD `infrastructure/repositories/DrizzleBookingRepository.ts` — findToday→findByDay; rowToBooking maps kind, drops returnedCount/dispatchedAt; bookingToInsert includes kind, drops removed columns; update() drops removed columns; findAll removed.

### 2026-06-25 — nexus (T3 — Server layer)

**lib/**
- MOD `lib/time.ts` — added three pure day-navigation helpers (DEC-P2, DEC-E):
  `parseDayParam(dayStr, now): Date` — parses `?day=YYYY-MM-DD` → UTC noon on that Zagreb day; falls back to `now` on missing/invalid input; pure (no Date.now() inside).
  `formatDayParam(day): Date → 'YYYY-MM-DD'` — formats in Europe/Zagreb; used to build `?day=` hrefs.
  `addDays(day, n): Date` — noon-anchored day offset; DST-safe for prev/next nav.

**app/**
- MOD `app/page.tsx` — full rewrite for reservation-pivot:
  Reads `?day=YYYY-MM-DD` (parseDayParam) and `?fine=1` (bucketMin=5 vs 15).
  Pre-computes dayParam/prevDayParam/nextDayParam/todayParam/isToday strings so BoardView needs no date math.
  Calls `getDayBoard({ day, bucketMin })` via Promise.all wrapper.
  Throws on failure → error.tsx. Passes DayBoard + nav props to `<BoardView>`.
  Removed: `getBoardSnapshot` import, `showHistory` param, old `snapshot` prop.
  Kept: `force-dynamic`, `revalidate=0`.

- MOD `app/actions.ts` — full rewrite for reservation-pivot:
  REMOVED: `sendOutAction`, `returnSkisAction`, `extendBookingAction` (DEC-P1).
  RESHAPED: `createBookingAction` (startTimeMs epoch-ms; maps PAST_START), `editBookingAction` (startTimeMs epoch-ms; maps IMMUTABLE_PAST/PAST_START), `cancelBookingAction` (maps IMMUTABLE_PAST).
  ADDED: `blockScooterAction` (startTimeMs+endTimeMs epoch-ms; kind='maintenance'; DEC-P3).
  ADDED: `computeOpenSlotsAction` (typed query; fromTimeMs epoch-ms; DEC-P5).
  ADDED: `proposeReconciliationAction` (typed query; DisruptionWire with ms; returns ReconciliationProposalWire with ms; DEC-P6).
  ADDED: `applyReconciliationAction` (typed mutation; ReconciliationProposalWire → ReconciliationProposal via ms→Date; DEC-P6).
  KEPT: `computeAvailabilityAction` (unchanged contract; startTimeMs epoch-ms).
  Croatian error mapping: extended with PAST_START, IMMUTABLE_PAST.
  All Dates cross boundary as epoch-ms (serialization rule throughout).

- MOD `app/_components/BoardView/BoardView.tsx` — prop interface updated:
  Replaced `{ snapshot: BoardSnapshot; showHistory: boolean }` with new 7-prop interface (board: DayBoard + nav/fine booleans/strings).
  Body replaced with `return null` (nexus handoff state). Frankie fills in T4.
  Old child-component imports removed (they were unused after body stub).

**Compilation state:**
`app/page.tsx` and `app/actions.ts` compile with zero errors.
`app/_components/BoardView/BoardView.tsx` compiles with zero errors.
Remaining errors are ALL in frankie's surface (_components/AvailabilityHeader, BookingRow, BookingsList, StatusPill) — expected T4 work.
See `HANDOFF.yaml` for the exact error list and full next_steps_for_frankie.

### 2026-06-25 — frankie (T4 — UI shell rebuild)

<!-- This entry was blocked by the frankie-scope-guard at write time; recorded here by spec. -->

- ADD `app/_components/DayNav/DayNav.tsx` — brutally-simple Prev / Today / Next day switcher (AC-3, DEC-P2).
- ADD `app/_components/DensityChart/DensityChart.tsx` — popular-times-style stacked bar chart, 5/15-min buckets, reserved + maintenance vs fleet=8 (AC-7, DEC-P4).
- ADD `app/_components/UtilizationPanel/UtilizationPanel.tsx` — daily utilization % + peak / busiest-hour / idle (AC-8, DEC-P7).
- ADD `app/_components/MaintenanceBlockPanel/MaintenanceBlockPanel.tsx` — mark a scooter unavailable for a window (AC-4, DEC-P3).
- ADD `app/_components/ReconciliationPanel/ReconciliationPanel.tsx` — disruption proposal + apply (AC-6, DEC-P6).
- ADD `app/_containers/MaintenanceFormContainer/MaintenanceFormContainer.tsx` — `'use client'` container for the maintenance-block flow.
- ADD `app/_containers/ReconciliationContainer/ReconciliationContainer.tsx` — `'use client'` container for the reconciliation propose/apply flow.
- MOD `app/_components/{BoardView,AvailabilityHeader,BookingsList,BookingRow,StatusPill,BookingFormPanel}/*.tsx` — reshaped to DayBoard; `reserved | cancelled` × `reservation | maintenance`; slot-finder results; future-only / past-read-only row actions; removed send-out / return / extend / history affordances (AC-1, DEC-P1).
- MOD `app/_containers/{BookingFormContainer,BookingEditContainer}/*.tsx` — `computeOpenSlots` slot-finder call (AC-5); `startTimeMs` epoch-ms serialization; past-day create gate (DEC-P2).
- MOD `app/loading.tsx` — skeleton mirrors the new layout; deterministic bar heights.
- DEL `app/_components/HistoryToggle/HistoryToggle.tsx` — orphan from the removed history feature (audit remediation; architecture §8).

### 2026-06-25 — frankie (audit remediation)

- MOD `app/_components/BookingEditPanel/BookingEditPanel.tsx` — removed an unnecessary `as unknown as` double-cast → single honest cast (architecture §10).

### 2026-06-25 — donnie (reconcile fix)

- MOD `modules/bookings/domain/availability.ts` — fixed correctness bug in `reconcile()` for the `delay` disruption type (DEC-P6). Root cause: the disrupted booking (the CAUSE of the delay) was included in the "upcoming reservations to shift" candidate set because its `startTime >= now` predicate was true; its extended `endTime` (after the delay was applied to the timeline) made it appear infeasible against itself, pushing it into `unresolvable` incorrectly. Fix: derive `disruptedId = disruption.type === 'delay' ? disruption.bookingId : null` and filter it out of `upcoming` (`b.id !== disruptedId`). The delayed booking stays put on the timeline (already mutated with the extended endTime) so it continues to consume capacity correctly over its stretched window; only downstream reservations that no longer fit become candidates. `capacity_drop` path unaffected (no `bookingId` on that union arm; `disruptedId` is null). Verified: scenario X=5 12:00–13:00 + Y=5 13:00–14:00, delay X +30 → `changes=[Y: 13:00→13:30 +30], unresolvable=[]` (was `unresolvable=['X']` before fix). R-AVAIL-3 half-open semantics and purity contract (no Date.now()) preserved. tsc --noEmit --noUnusedLocals --noUnusedParameters: 0 errors.

### 2026-06-25 — donnie (timebox density/utilization)

**Windowing logic:** Density and utilization are now timeboxed to the actual booked window, not the fixed 08:00–20:00 operating window. `windowStart = floorToHour(earliest confirmed reservation startTime)`, `windowEnd = ceilToHour(latest confirmed reservation endTime)`. "Confirmed reservation" = `kind === 'reservation' && status !== 'cancelled'`. Maintenance blocks do NOT define the bounds — they are clipped to the window for display/metrics. No confirmed reservations → `windowStart`/`windowEnd` null, `density = []`, utilization all-zero (divide-by-zero guarded by 1-minute stub window).

**Config removed:** `OPERATING_DAY_START_HOUR`, `OPERATING_DAY_END_HOUR`, `operatingWindowStart()`, `operatingWindowEnd()` — all were exclusively consumed by `getDayBoardUseCase.ts` for the fixed-window call. After this change they had zero in-repo consumers. Removed per donnie-rules §6.11. `DENSITY_BUCKET_MIN_FINE` retained — not imported as a TypeScript module (page uses inline literals per ddd-architecture §3 import boundary) but intentionally exported as a self-documenting domain constant.

**Config added:** `floorToHour(d: Date): Date` and `ceilToHour(d: Date): Date` — epoch-ms grid helpers, `Math.floor/ceil(ms / 3_600_000) * 3_600_000`. Pure (no Date.now()), deterministic, land on wall-clock :00 in Europe/Zagreb because UTC offset is a whole number of hours.

**Verification scenarios (mental):**
- Reservation 09:20→14:40 (Zagreb): `windowStart` = 09:00, `windowEnd` = 15:00; density spans exactly 09:00–15:00; `capacityMinutes` = 8 × 360 = 2880 ✓
- No reservations: `density = []`, `utilizationPct = 0`, `windowStart`/`windowEnd` null, board constructs without crash ✓
- Maintenance block extending past last reservation: ignored by confirmed-reservation filter; does not extend `windowEnd` ✓

**Files changed:**
- MOD `modules/bookings/domain/config.ts` — removed OPERATING_DAY_START_HOUR, OPERATING_DAY_END_HOUR, operatingWindowStart(), operatingWindowEnd(); added floorToHour(), ceilToHour(), HOUR_MS constant.
- MOD `modules/bookings/domain/types.ts` — added `windowStart: Date | null` and `windowEnd: Date | null` to `DayBoard`.
- MOD `modules/bookings/domain/availability.ts` — `utilizationReport` signature changed from `(records, _dayStart, _dayEnd, operatingStart, operatingEnd, fleet)` to `(records, windowStart, windowEnd, fleet)`. Removed the two unused `_dayStart`/`_dayEnd` parameters; renamed `operatingStart`/`operatingEnd` to `windowStart`/`windowEnd` to reflect the timeboxed contract. All internal computations (clipping, peakConcurrent, busiest-hour scan) now operate over the passed window. R-AVAIL-3 intact. Purity intact.
- MOD `modules/bookings/application/getDayBoardUseCase.ts` — computes confirmed-reservation set; derives `windowStart`/`windowEnd` (floorToHour/ceilToHour) or null; passes timeboxed window to `densityProfile` and `utilizationReport`; handles null/empty case; adds `windowStart`/`windowEnd` to the `DayBoard` result.
- tsc --noEmit --noUnusedLocals --noUnusedParameters: 0 errors.

### 2026-06-25 — donnie (audit remediation)

- MOD `modules/bookings/domain/availability.ts` — eliminated `fitsWithFleet` and `openSlotsWithFleet` (the two private helpers that duplicated the boundary-scan logic solely to swap in a custom fleet value). Folded the `fleet` argument into `fits` and `openSlots` as an optional trailing parameter defaulting to `FLEET_SIZE`, keeping all existing call sites valid without modification. Updated `reconcile` to call `fits(others, q, start, end, fleet)` and `openSlots(others, q, dur, from, dayEnd, 1, fleet)` directly. `nextOpening` continues to delegate to `openSlots(…)` with the default fleet — no separate scan. R-AVAIL-3 half-open `[start,end)` semantics are unchanged; purity contract preserved (no Date.now(), fleet passed in). tsc --noEmit --noUnusedLocals --noUnusedParameters: 0 errors.

### 2026-06-25 — donnie (5-min slot grid)

- ADD `modules/bookings/domain/config.ts` — exported `SLOT_GRANULARITY_MIN = 5` (new constant; R-AVAIL-6). Docstring explains the epoch-ms grid alignment and why it lands on wall-clock :00/:05/…/:55 for Europe/Zagreb.
- MOD `modules/bookings/domain/availability.ts` — rewrote `openSlots` candidate generation: replaced the record-boundary candidate set with a uniform 5-minute grid. First candidate = `fromTime` rounded UP to the next `SLOT_GRANULARITY_MIN` mark via `Math.ceil(ms / stepMs) * stepMs` on the absolute epoch-ms axis. Grid steps forward in `stepMs` increments up to `latestStart = dayEnd − durationMin`; loop breaks early once `maxResults` is reached (≤ 144 iterations for a 12-hour window). R-AVAIL-3 half-open `[start,end)` semantics preserved (unchanged `fits` / `peakCommitment`). Purity contract preserved (no `Date.now()` inside). `nextOpening` still delegates to `openSlots` so the first opening is also 5-min-aligned. `reconcile` calls `openSlots` for re-scheduling and will now also propose 5-min-aligned shifts (correct/desirable). `fits`, `peakCommitment`, `commitmentAt`, `densityProfile`, `utilizationReport`, `reconcile` bodies unchanged. tsc --noEmit --noUnusedLocals --noUnusedParameters: 0 errors.
- Verified (self-contained .mjs scratch — deleted after run, 17/17 assertions):
  - Scenario A (SPEC regression): records A=4@12:00–13:00, B=2@12:30–13:15; `openSlots(records,3,45,12:45,20:00,8)[0]` → 13:00 Zagreb (correct; 13:00 is a 5-min mark and the first feasible slot).
  - Scenario B (off-grid proof): maintenance block 8 scooters 12:00–13:02; `openSlots(records,1,30,13:00,20:00,4)[0]` → 13:05 Zagreb (NOT 13:02); 13:02 is absent from all returned slots.
  - Scenario C: `fromTime` already on a grid mark → kept as-is (no over-rounding).
  - Scenario D: `fromTime` at 09:01 → rounded up to 09:05.
  - All returned slots confirmed multiples of 5 minutes past the hour across all scenarios.

### 2026-06-25 — frankie (round 2 — UX feedback)

- ADD `app/_containers/BoardTabsContainer/BoardTabsContainer.tsx` — `'use client'` two-tab split; state survives the 2s `router.refresh()` poll; server panels passed in as children.
- MOD `app/_components/BoardView/BoardView.tsx` — composes DayNav + AvailabilityHeader above a tab bar: Tab "Raspored" = create / list / maintenance / reconciliation; Tab "Gustoća" = density + utilization. Declutters the first screen.
- MOD `app/_components/BookingFormPanel/BookingFormPanel.tsx` + `app/_containers/BookingFormContainer/BookingFormContainer.tsx` — primary grouped flow: Broj skutera + Trajanje + Prvi slobodni termin as the hero, one-tap "Rezerviraj u HH:MM"; other 5-min slots + manual HH:MM kept as a secondary escape hatch.
- MOD `app/_components/DensityChart/DensityChart.tsx` — cleaner stacked bars; fleet-ceiling gridline; legend; timeboxed x-axis from windowStart..windowEnd; empty state.
- MOD `app/_components/UtilizationPanel/UtilizationPanel.tsx` — timeboxed period label; consumes windowStart/windowEnd.
- MOD `app/loading.tsx` — skeleton mirrors the tabbed layout.

### 2026-06-25 — infra (dev seed + clear tooling)

- ADD `infra/dev-seed.mjs` — packed-day dummy seed: ~36 reservations + 2 maintenance across the day; concurrency peaks at 8/8 ≤ fleet; 5-min-aligned starts; Croatian labels; idempotent.
- ADD `infra/dev-clear.mjs` — full DB clear (`DELETE FROM bookings`); guarded if the table is absent.
- MOD `package.json` — npm scripts: `seed` → `node infra/dev-seed.mjs`; `db:clear` → `node infra/dev-clear.mjs`.

### 2026-07-03 — fleet size 8 → 6 (DEC-P10)

- MOD `modules/bookings/domain/config.ts` — `FLEET_SIZE = 6` (was `8`). The single source of truth for fleet capacity; threaded into the pure engine per DEC-P9, so every fit / density / slot-finder / reconciliation / utilization computation now caps at 6 without any math reshape.
- MOD `modules/bookings/schema/bookings.ts` — DB CHECK `bookings_quantity_range` tightened from `quantity BETWEEN 1 AND 8` to `1 AND 6` (DEC-P10) to keep the schema in agreement with the domain (architecture.md §2).
- ADD `modules/bookings/schema/migrations/0001_bitter_magneto.sql` — generated migration for the tightened CHECK. **Generated, NOT yet applied.** Migration gate: the operator runs `SELECT count(*) FROM bookings WHERE quantity > 6` against production BEFORE the first deploy; if `0`, it applies cleanly. Migrate-on-deploy is fail-closed by design, so a data-incompatible migration blocks the deploy rather than corrupting data (see the app-wide migrate-on-deploy change-unit at `system/context/app/features/migrate-on-deploy/SPEC.md`).
- 2026-07-03 UPDATE (DEC-P10) — operator confirmed prod is a **clean slate** (no migrations run yet): `0000` CREATEs `bookings` empty with CHECK `1..8`, then `0001_bitter_magneto` DROP/ADDs `1..6` in the same first-deploy pass before any row is written, so the `quantity > 6` pre-deploy gate is **moot on first deploy** (returns 0 by definition) — tighten ships with zero data risk. Original gate retained as the correct check should the tighten ever apply to a populated DB later.
- Note: prior Change Log / verification entries dated 2026-06-25 (e.g. the `fleet=8` DensityChart entry and the "8 scooters" reconcile scenario) are append-only records of the pre-DEC-P10 state and are left as-is; DEC-P10 is the current fleet-size decision of record.

### 2026-07-03 — frankie (fleet size 6 everywhere — UI scooter-quantity pickers, DEC-P10 completion)

Completes the DEC-P10 8→6 migration tail on the *input* side. The earlier 2026-07-03 CARD/Verdict entry above covered three *display* components (AvailabilityHeader, DensityChart, UtilizationPanel); this entry covers the five *quantity-picker* surfaces that still offered 1–8 and used `grid-cols-8`. All corrected to cap at 6 using the codebase's established "mirror the domain constant with a provenance comment" pattern (`const FLEET_SIZE = 6; QUANTITIES = Array.from({ length: FLEET_SIZE }, …)`), because `app/` cannot import `modules/**/domain/config` — only `domain/types` is public (project-structure §4). Grids changed `grid-cols-8` → `grid-cols-6`.

- MOD `app/_components/BookingFormFields/BookingFormFields.tsx` — quantity segmented control capped at 6 (`FLEET_SIZE = 6`, `QUANTITIES` length 6, `grid grid-cols-6`); provenance comment naming DEC-P10 + the app→domain boundary rationale.
- MOD `app/_components/BookingFormPanel/BookingFormPanel.tsx` — same `FLEET_SIZE = 6` mirror + `grid-cols-6` quantity group (`aria-label="Broj skutera"`).
- MOD `app/_components/MaintenanceEditPanel/MaintenanceEditPanel.tsx` — maintenance quantity 1–6 grid (`FLEET_SIZE = 6`, `grid-cols-6`).
- MOD `app/_components/MaintenanceBlockPanel/MaintenanceBlockPanel.tsx` — block-scooter quantity 1–6 grid (`FLEET_SIZE = 6`, `grid-cols-6`).
- MOD `app/_components/ReconciliationPanel/ReconciliationPanel.tsx` — capacity-drop quantity picker capped at 6 (`FLEET_SIZE = 6`, `DROP_QUANTITIES` length 6, `grid-cols-6`).
- MOD `app/_components/BookingFormFields/croatian.ts` — comments corrected to the 1–6 fleet range.
- Ships together in the production deploy now being triggered, alongside the booking capacity concurrency fix (see the sibling `booking-concurrency` SPEC). Operational note (not a code change-unit): the live Neon DB is missing the `audit_events` table because the audit migration set has not yet run in production — the same deploy applies it.

**Auditor verdict: WARN — one CONCERN (known follow-up, not fixed here).** `FLEET_SIZE = 6` is now mirrored across ~7 UI files (the three display components + these five pickers; some overlap) in addition to the domain SSoT (`modules/bookings/domain/config.ts`) and the schema CHECK. The 8→6 drift that just occurred is exactly the failure a single source of truth prevents. KNOWN FOLLOW-UP: expose the fleet cap through `modules/bookings/domain/types` (public — importable by `app/` without breaching project-structure §4), or introduce one app-side presentational constant fed from a server-component prop, so the next fleet change touches one place instead of seven. Not resolved in this change-unit — recorded so it is not lost. Tagged against `architecture.md §9` (this now sits well past the three-use threshold where the abstraction is justified) and `architecture.md §13` (long-term maintainability).

## Verification

<!-- Self-verification record (not an AUTO block). Owned by spec/orchestrator, not the auditor. -->

Scenario self-verification on local infrastructure (Node v26 + esbuild bundle + isolated SQLite + live dev server): 78 assertions across pure-domain truth (worked example A overlap + next-opening, boundary handoff R-AVAIL-3, maintenance reduces availability, slot-finder ordering, density profile, utilization %, reconciliation minimal proposal, canCancel), DB + use-case integration (schema integrity — status='out' rejected, no returned_count/dispatched_at, kind defaults; PAST_START/IMMUTABLE_PAST guards; blockScooter honest over-commitment; reconciliation round-trip), and end-to-end UI smoke (day nav, density, utilization, reservations render; 200 on today/other-day/fine). One real bug found in reconcile (delayed booking spuriously unresolvable) — FIXED and re-verified. Final auditor verdict: PASS. Operational note: the app's Docker image (jet-board:dev) is pre-pivot/stale — run `pnpm docker:build` to refresh it before using the containerized workflow; a host `next dev` on :4425 currently serves the new schema.

Round 2 (5-min slot grid, timeboxed density/utilization, Gustoća-tab split, primary slot-finder create group): tsc + lint clean; donnie scratch-verified 5-min grid (regression first-slot 13:00, off-grid→13:05, all slots 5-min) and timeboxing (09:20–14:40 ⇒ 09:00–15:00 window; empty-day safe); infra packed-day seed holds concurrency ≤ 8; UI smoke on :4425 confirms both tabs, the primary slot-finder group, density legend, and utilization render with no errors. Auditor round-2 verdict: PASS with one low note. Known low: 2 cosmetic unused-var lint warnings in the dev-only infra/dev-seed.mjs.

<!-- AUTO:WORKLOG — appended (never overwritten) by the auditor on every run -->
## Worklog

2026-06-25  auditor  engineering review  WARN  Sacred core + use cases + actions + page clean; 2 concerns (orphan HistoryToggle, unnecessary double-cast), reconcile fleet-variant duplication noted.
2026-06-25  auditor  delta re-audit  PASS  All prior concerns/notes remediated (orphan deleted, double-cast collapsed, fleet-variant duplicates folded into fits/openSlots); new reconcile delay fix clean — pure, type-safe, capacity_drop unaffected, minimality preserved.
2026-06-25  auditor  delta re-audit r2  PASS with notes  5-min slot grid + timeboxed density/util + Gustoća-tab UI all clean; sole note: DENSITY_BUCKET_MIN_FINE exported but unimported (defensible self-doc constant, §8).
2026-07-03  auditor  engineering review  PASS with notes  Fleet-const bugfix: 3 UI files FLEET 8→6 + stale comments corrected; completes DEC-P10 8→6 migration tail (§8). Pure server components, boundary respected. Sole note: FLEET now duplicated across 3 UI files (deliberate, at §9 threshold).

<!-- /AUTO:WORKLOG -->

<!-- AUTO:VERDICT — overwritten by the auditor on every run -->
## Verdict
**PASS with notes** · 2026-07-03T00:00:00Z (fleet-const bugfix)

This diff fixes the operator-reported "6/8 slobodnih" bug by changing the local display constant `FLEET` from 8 to 6 in the three lagging presentational components (`AvailabilityHeader`, `DensityChart`, `UtilizationPanel`) and correcting their now-stale comments and JSDoc in lockstep. It is the textbook shape of an architecture.md §8 remediation, not a §8 violation: the domain single source of truth (`FLEET_SIZE = 6` in `modules/bookings/domain/config.ts`) and the DB schema (`quantity 1..6`) were already migrated under DEC-P10; these UI constants were the untracked tail of that migration. The change closes the gap and introduces no new half-finished state — no stubs, no dead exports, no half-migrated split. The `aria-label` strings that interpolate `${FLEET}` ("od 6 skutera") are corrected as a side effect, so the accessibility announcement is fixed alongside the visible number.

The components are exemplary against §10 (code is communication): every `const FLEET = 6` is paired with a comment naming the value's provenance (DEC-P10, 2026-07-03) and — more valuably — *why* it is a local constant rather than an import (`not imported from domain/config (app→domain boundary)`). That answers the reviewer's first question before it is asked. All three files remain pure Server Components under `_components/`: props → JSX, no hooks, no `'use client'`, no client surface added (react-components §4, server-first-react). They import only `@/modules/bookings/domain/types` (public surface) and correctly avoid importing `domain/config`, honoring the one-way app→domain boundary (project-structure §4, ddd-architecture §3). No JSX, styling, props, or calculation logic changed, so frankie-rules §2.1/§5/§6 are untouched — semantic tokens, semantic HTML, and `<Link>`-based navigation all remain intact.

One note for awareness, not action: `FLEET = 6` now lives as a literal in three UI files in addition to the domain SSoT and the schema, so the next fleet change touches five sites. This is a deliberate trade to respect the import boundary (documented in each file) and sits exactly at architecture.md §9's three-concrete-uses threshold — the point at which an abstraction *may* be justified but is not yet required. It does not rise to a concern for this diff, which reduces divergence rather than adding it. If the fleet size proves volatile, a future change-unit could introduce a single presentational constant (e.g., a shared UI display constant fed from a server component prop) — an orchestrator/frankie decision, out of scope here.

No violations, no concerns. Ship-ready from an architectural standpoint.

<!-- /AUTO:VERDICT -->
