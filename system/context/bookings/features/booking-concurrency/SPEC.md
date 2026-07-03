<!--
SPEC.md — working memory for one change-unit.

Lives at: system/context/bookings/features/booking-concurrency/SPEC.md

This change-unit hardens the reservation-pivot module (sibling SPEC at
../reservation-pivot/SPEC.md) against a concurrency defect: capacity-mutating
writers could overbook the fleet under a non-atomic read-check-write. The
availability engine (DEC-P9 / DEC-A) and the fleet-size decision (DEC-P10) are
carried forward untouched; this change only serialises the writes that consume
capacity.
-->

---
id: bookings-booking-concurrency
slug: booking-concurrency
module: bookings
type: bugfix
state: working
created: 2026-07-03
updated: 2026-07-03
---

<!-- AUTO:CARD — overwritten by the auditor on every run -->
## CARD

_no audit run yet — see the auditor verdict summarised in the Worklog below_

<!-- /AUTO:CARD -->

## Intent

Every capacity-mutating operation on the reservation board (create a reservation, edit a reservation, block scooters for maintenance, edit a maintenance block) followed the same shape: read the day's bookings via `findByDay`, run the pure `fits()` fleet-capacity check, then `save`/`update`. That sequence was **non-atomic** — no transaction, no lock, and (because the capacity rule is an aggregate, not a per-row uniqueness) no DB constraint could backstop it. Two operators acting at the same time on a fleet of 6 could each read a board that still had room, each pass `fits()`, and each write — overbooking the fleet. The failure mode became the norm rather than an edge case once the ~2s board polling was removed (booth-board Decision #4, superseded 2026-07-03): operators now routinely act on stale boards, so the read-check-write window is wide open.

Root cause: the fleet-capacity rule is an **aggregate invariant** — the sum of overlapping quantities across the day must stay ≤ `FLEET_SIZE`. Postgres cannot express that as a `UNIQUE` or `EXCLUSION` constraint (it is a windowed sum, not a per-row predicate), so the only correct fix is to **serialise** the read-check-write so that at most one writer per day evaluates capacity at a time and the loser re-evaluates against the winner's committed state.

The fix wraps each capacity-mutating use case's read → `fits()` → write inside a single Postgres transaction guarded by a **per-day advisory lock** (`pg_advisory_xact_lock`). All writers for the same local day serialise on the same lock key, so the second writer blocks, then re-reads inside its own transaction, re-runs `fits()`, and returns `CAPACITY_EXCEEDED` if the winner already filled the fleet. The board never overbooks.

## Scope

**In**
- A new repository-port method `withDayLock<T>(day, fn)` that opens a DB transaction, acquires a per-day Postgres advisory lock, and runs `fn` against a transaction-scoped repository — so use cases serialise capacity writes without ever importing the ORM (ddd-architecture §1 preserved).
- Wrapping the read → `fits()` → write of every capacity-mutating use case inside `withDayLock`: create reservation, edit reservation, block scooter (maintenance), edit maintenance.
- The loser of a race re-reads inside the transaction, re-evaluates `fits()`, and returns `CAPACITY_EXCEEDED` (reservation paths) or applies the honest-over-commitment write (maintenance paths, which intentionally skip `fits()` per DEC-P3).

**Out**
- `cancelBookingUseCase` — **intentionally not locked.** Freeing capacity can never overbook, so serialisation buys nothing.
- `applyReconciliationUseCase` — **NOT fixed in this change-unit.** It is a pre-existing capacity-affecting writer with no `fits()` re-check and no lock; see the KNOWN FOLLOW-UP under Decisions. Recorded here so it is not lost.
- The availability engine (`domain/availability.ts` and siblings) — untouched. `fits()` / `peakCommitment()` / `openSlots()` etc. keep their pure contract (DEC-P9). The fix is purely about *when and under what isolation* the shell calls them.
- The audit write — stays **outside** the transaction (DEC-AU6 fail-open; module isolation intact). A failed audit write must never roll back a committed booking.
- Fleet size — unchanged at 6 (DEC-P10, owned by the reservation-pivot SPEC).
- Schema — no migration; the advisory lock is a runtime call, not a table or constraint change.

## Decisions

1. **DEC-C1 — Per-day Postgres advisory lock, not an aggregate DB constraint.** The capacity rule is an aggregate (sum of overlapping quantities across the day ≤ `FLEET_SIZE`), which Postgres cannot express as a `UNIQUE` / `EXCLUSION` constraint. So the read-check-write is **serialised** instead: each capacity-mutating use case runs inside a DB transaction that first calls `pg_advisory_xact_lock(dayKey)`. **Lock key = days-since-epoch of `toLocalDayStart(startTime)`** (a stable `bigint`), so every writer touching the same local day contends on the same key; different days never block each other. The loser blocks, then re-reads inside its transaction, re-runs `fits()`, and returns `CAPACITY_EXCEEDED`. **Rejected:** a table-level constraint (impossible for a windowed aggregate); `SELECT … FOR UPDATE` row locks (there is no single row that represents "the day's capacity" to lock — the invariant spans many rows and future inserts); a global mutex / single-writer serialisation (needlessly serialises unrelated days, killing throughput on a booth that plans many days). **Why:** the advisory lock scopes contention to exactly the granularity of the invariant (one local day) and releases automatically at transaction end. Tagged against `architecture.md §2` (trust boundary — the invariant is enforced where the side effect happens) and `architecture.md §6` (idempotency/serialisation on concurrent writers).

2. **DEC-C2 — The lock is exposed through the repository port as `withDayLock<T>(day, fn)`, so use cases never import the ORM.** The transaction + `pg_advisory_xact_lock` + tx-scoped repository construction all live in `DrizzleBookingRepository`; the use case only sees `bookingRepo.withDayLock(day, async (txRepo) => { … read/check/write via txRepo … })`. **Rejected:** having each use case open its own `db.transaction(...)` (would force the application layer to import the ORM — a hard ddd-architecture §1 layer-skip violation); a separate "locking service" class (violates the no-service-class rule — architecture.md §4). **Why:** the port keeps the application layer pure orchestration over a domain interface (ddd-architecture §1/§3); the ORM stays sealed in infrastructure.

3. **DEC-C3 — The audit write stays OUTSIDE the transaction (DEC-AU6 fail-open preserved).** The audit event is emitted after the locked read-check-write commits, not inside `withDayLock`'s `fn`. **Rejected:** wrapping the audit write in the same transaction (a failed/slow audit write would roll back a legitimate, committed booking — the opposite of the audit-log's fail-open contract, and it would couple the bookings transaction to the audit module's availability, breaking module isolation). **Why:** DEC-AU6 (audit-log SPEC) mandates fail-open — auditing must never block or reverse the business operation it observes.

4. **DEC-C4 — Applied to all four capacity-mutating writers; cancel intentionally excluded.** `createBookingUseCase`, `editBookingUseCase`, `blockScooterUseCase`, and `editMaintenanceUseCase` are wrapped. The maintenance writers still deliberately skip `fits()` inside the lock (DEC-P3 — a malfunction is honest over-commitment), but are locked so their read-modify-write of the shared day is still consistent. `cancelBookingUseCase` is **not** locked — freeing capacity cannot overbook. **Why:** serialise exactly the operations that can violate the aggregate invariant, and no more (architecture.md §12 — pragmatism; do not serialise writes that are provably safe).

<!-- KNOWN FOLLOW-UP / open question — recorded so the auditor's WARN item is not lost. -->

5. **DEC-C5 (OPEN — not fixed here) — `applyReconciliationUseCase` is an unlocked, capacity-affecting writer.** `applyReconciliationUseCase` applies a *previously computed* reconciliation proposal (the shifts `proposeReconciliationUseCase` produced) with **no `fits()` re-check and no `withDayLock`**. A booking committed by another operator **between propose and apply** could push a shifted reservation past `FLEET_SIZE` when the proposal is applied — the same overbooking class this change-unit closes for create/edit, still open on the reconciliation apply path. This is the sole open item in the auditor's WARN verdict for this change-unit. **Not fixed here** because reconciliation apply has additional design questions (does it re-validate and re-propose on stale input, or reject and force a fresh proposal?) that deserve their own change-unit. **Next action:** a follow-up change-unit should either wrap `applyReconciliationUseCase` in `withDayLock` + a `fits()` re-check over the final proposed state, or re-run `proposeReconciliation` inside the lock and reject on divergence. Tagged against `architecture.md §16` (high agency — surface the gap, don't silently route around it).

## Acceptance Criteria

- Two operators submitting capacity-consuming reservations on the same day at the same time cannot both succeed past `FLEET_SIZE`: exactly one commits, the other re-evaluates against the committed state and receives `CAPACITY_EXCEEDED`.
- Each of create-reservation, edit-reservation, block-scooter, and edit-maintenance performs its read → check → write inside a single transaction holding the per-day advisory lock.
- Writers for two *different* local days do not block each other (the lock key is per-day).
- The maintenance writers (block-scooter, edit-maintenance) still record honest over-commitment (no `fits()` gate — DEC-P3) but do so under the day lock.
- Use case files import no ORM / db client — the transaction and lock live entirely behind `IBookingRepository.withDayLock` (ddd-architecture §1/§3).
- The audit write for each mutation happens outside the locked transaction; a failed audit write does not roll back the booking (DEC-AU6 fail-open).
- `cancelBookingUseCase` is unchanged and unlocked.
- KNOWN OPEN: `applyReconciliationUseCase` still has no `fits()` re-check and no lock; a booking committed between propose and apply can overbook on apply (DEC-C5) — tracked as a follow-up, not resolved here.

## Tasks

- [x] T1 — Add `withDayLock<T>(day, fn)` to the `IBookingRepository` port (owner: donnie)
- [x] T2 — Implement `withDayLock` in `DrizzleBookingRepository`: open transaction, `pg_advisory_xact_lock(dayKey)`, construct tx-scoped repo, run `fn` (owner: donnie)
- [x] T3 — Wrap read → `fits()` → write of `createBookingUseCase` and `editBookingUseCase` in `withDayLock`; return `CAPACITY_EXCEEDED` on the loser's re-check (owner: donnie)
- [x] T4 — Wrap `blockScooterUseCase` and `editMaintenanceUseCase` read-modify-write in `withDayLock` (no `fits()` gate — DEC-P3) (owner: donnie)
- [x] T5 — Architectural review of the concurrency change-unit (owner: auditor) — verdict WARN, sole open item DEC-C5 (`applyReconciliationUseCase`)
- [ ] T6 (FOLLOW-UP — not this change-unit) — Close DEC-C5: lock + re-check `applyReconciliationUseCase`, or re-propose-inside-lock-and-reject-on-divergence (owner: donnie)

## Change Log

<!-- ADD / MOD / DEL prefix; appended by implementing agents as work lands. -->

### 2026-07-03 — donnie (booking capacity concurrency fix)

- MOD `modules/bookings/domain/repository.ts` — added `withDayLock<T>(day, fn)` to the `IBookingRepository` port: executes `fn` atomically under a per-day Postgres advisory lock inside a transaction; `fn` receives a tx-scoped `IBookingRepository` sharing that transaction. Documents that the audit write (DEC-AU6 fail-open) must stay outside the call (DEC-C1, DEC-C2, DEC-C3).
- MOD `modules/bookings/infrastructure/repositories/DrizzleBookingRepository.ts` — implemented `withDayLock`: derives a stable per-day `bigint` lock key (days-since-epoch of `toLocalDayStart`), opens `db.transaction`, acquires `pg_advisory_xact_lock(dayKey::bigint)`, constructs a tx-scoped repository (`makeBookingRepository(tx)`) so reads and writes inside `fn` share the transaction and see each other's uncommitted state; lock releases automatically at commit/rollback (DEC-C1, DEC-C2).
- MOD `modules/bookings/application/createBookingUseCase.ts` — `findByDay → fits() → save` now runs inside `withDayLock(day, …)`; the loser of a race re-reads the committed state inside the transaction, re-runs `fits()`, and returns `CAPACITY_EXCEEDED` (DEC-C1, DEC-C4). `fits()` still always enforced (DEC-B).
- MOD `modules/bookings/application/editBookingUseCase.ts` — `findByDay → fits() → update` wrapped in `withDayLock`; re-evaluates `fits()` against the committed day inside the lock and returns `CAPACITY_EXCEEDED` on the loser (DEC-C1, DEC-C4). IMMUTABLE_PAST / PAST_START guards unchanged.
- MOD `modules/bookings/application/blockScooterUseCase.ts` — maintenance-block read-modify-write wrapped in `withDayLock`; NO `fits()` gate (DEC-P3 honest over-commitment) but now serialised under the day lock (DEC-C4).
- MOD `modules/bookings/application/editMaintenanceUseCase.ts` — maintenance-edit read-modify-write wrapped in `withDayLock`; NO `fits()` gate (DEC-EM1 / DEC-P3 / DEC-EM3) but serialised under the day lock (DEC-C4).
- Not touched: `cancelBookingUseCase` (freeing capacity cannot overbook — DEC-C4); `applyReconciliationUseCase` (KNOWN OPEN — DEC-C5); the pure availability engine (DEC-P9).
- Ships together in the production deploy now being triggered, alongside the DEC-P10 fleet-size UI correction (see reservation-pivot SPEC). Operational note (not a code change-unit): the live Neon DB is missing the `audit_events` table because the audit migration set has not yet run in production — the deploy applies it.

<!-- AUTO:WORKLOG — appended (never overwritten) by the auditor on every run -->
## Worklog

2026-07-03  auditor  engineering review  WARN  Per-day advisory lock (pg_advisory_xact_lock) wraps read-check-write for all four capacity-mutating use cases; lock exposed through IBookingRepository.withDayLock so the application layer imports no ORM (ddd §1/§3 clean); audit write correctly outside the transaction (DEC-AU6 fail-open); cancel correctly unlocked. Sole open item: applyReconciliationUseCase is a pre-existing capacity-affecting writer with no fits() re-check and no lock — a booking committed between propose and apply can overbook on apply. Recorded as DEC-C5 follow-up.

<!-- /AUTO:WORKLOG -->

<!-- AUTO:VERDICT — overwritten by the auditor on every run -->
## Verdict

_no audit run yet — the WARN summary above was relayed from the orchestrator's report of the auditor pass; the AUTO block will be filled on the next auditor invocation against this SPEC._

<!-- /AUTO:VERDICT -->
