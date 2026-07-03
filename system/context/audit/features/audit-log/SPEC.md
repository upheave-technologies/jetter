<!--
SPEC.md — working memory for one change-unit.

Lives at: system/context/audit/features/audit-log/SPEC.md

This is a NEW APP-WIDE, CROSS-CUTTING concern, not a bookings sub-feature. It lives under
a new `audit` module folder because an audit log records EVERY action on the platform —
reservation mutations today, auth events and future non-booking events tomorrow. Housing it
inside modules/bookings/ would conflate concerns and leave nowhere for auth/login or future
events to live. It gets its own DDD module (domain/application/infrastructure), mirroring how
the app-wide access-gate SPEC lives under system/context/app/ rather than inside bookings.

It AUGMENTS — does not contradict — the bookings SPEC Decision DEC-P1 ("the Board has no user
accounts") and the access-gate DEC-AG1 ("one coarse shared-password gate above everything").
There are still no principals; the actor is the single shared operator (see DEC-AU4).

Cross-linked sibling change-unit (not yet created at draft time):
  system/context/bookings/features/edit-maintenance/SPEC.md
The editMaintenance use case being added there MUST also emit an audit event — the AuditWriter
injection in DEC-AU5 / T2 covers it. Keep the two SPECs in sync.
-->

---
id: audit-audit-log
slug: audit-log
module: audit
type: feature
state: done
created: 2026-07-02
updated: 2026-07-02
---

<!-- AUTO:CARD — overwritten by the auditor on every run -->
## CARD

## CARD — engineering review (Audit Log GUI removal) · 2026-07-02T00:00:00Z
**verdict** PASS with notes

**Changed files** 8 (5 deleted · 3 edited)
app/audit/**  (DELETED — page.tsx, loading.tsx, _components/AuditLogView/AuditLogView.tsx; dir removed)
modules/audit/application/listAuditEventsUseCase.ts + .capability.ts  (DELETED)
app/_components/BoardView/BoardView.tsx  (edited — removed footer Link + next/link import)
modules/audit/domain/repository.ts  (edited — removed findRecent + JSDoc)
modules/audit/infrastructure/repositories/DrizzleAuditEventRepository.ts  (edited — removed findRecent method)

**Findings** 0 violations · 0 concerns · 4 notes

**Removal integrity (verified)**
- Recording path INTACT end-to-end: recordAuditEvent use case + capability sidecar untouched; login/actions.ts still records auth events; auditWriterAdapter still wraps recordAuditEvent and is injected into all 6 bookings mutation use cases; schema / domain types / auditError / database singleton all untouched.
- No orphans: zero repo-wide hits for listAuditEvents, findRecent, AuditLogView; no dangling import of the deleted use-case path. Interface AND impl dropped findRecent together (no half-migrated interface). BoardView dropped both the Link block and the now-unused next/link import. tsc GREEN.

### architecture — architecture.md
**Notes**
- modules/audit/schema/auditEvents.ts:70,85  stale comments still reference "the /audit viewer" (removed). §8 — comment describing behavior no longer matches the post-edit reality. Schema is archie-owned + outside this change-unit's edits; flagging so archie/spec reconcile.
- modules/audit/schema/auditEvents.ts (idx_audit_events_occurred_at)  the `occurred_at DESC` index was justified ENTIRELY by "the dominant read is the paginated /audit viewer (DEC-AU8)"; that read is gone, leaving the index with no in-repo read path (only findByEntity remains, served by idx_audit_events_entity_id). §8 / archie-rules §2.VI (index where queries hit). Now-speculative — archie's call whether to keep for future reads or drop.

### donnie's rules — donnie-rules.md
**Notes**
- modules/audit/domain/repository.ts:34 / DrizzleAuditEventRepository.ts:116  findByEntity has no in-repo caller. PRE-EXISTING — it had no caller before this change-unit either; deliberately left out of scope. Not introduced by this removal. §6.11 awareness only.

### frankie's rules — frankie-rules.md
**Notes**
- app/_components/BoardView/BoardView.tsx  footer "Zapisnik" link + next/link import cleanly removed; server component intact, no orphan import (tsc noUnusedLocals GREEN). Clean removal — awareness only.

<!-- /AUTO:CARD -->

## Intent

The operator wants an **immutable, append-only audit log of everything that happens on the
platform**. Their verbatim ask: _"Add the audit log of all actions on the platform. The audit
log is an immutable record of everything that happened — every reservation creation / edit /
removal. Every time a user did anything, I want it tracked in an audit log."_

Today the platform is essentially one feature — the Reservation Planning Board
(`modules/bookings/`). Every meaningful action is a mutation on the `bookings` table: creating a
reservation, editing a future reservation, cancelling a reservation or a maintenance block,
creating a maintenance block, editing a maintenance block, or applying a reconciliation that
shifts multiple future reservations. Right now those actions leave no trail. Once a record is
edited or cancelled, the previous state is gone — there is no way to answer "who changed this,
when, and what did it look like before?"

This change adds a dedicated `audit` module that records one immutable event per action, capturing
**what was acted on, what action occurred, when, by whom (the shared operator), and before/after
snapshots** where they apply. The log is append-only and cannot be edited or deleted through any
application code path — immutability is the entire point; an audit trail you can quietly rewrite
is worthless.

**Current reality (as of 2026-07-02): the in-app viewer has been removed; the audit log is
operator-only via direct database access.** The recording path — capturing every mutation and auth
event into the immutable `audit_events` table — is fully intact and remains the entire point of the
feature. What is gone is the web UI for *viewing* the trail: there is no longer a `/audit` route,
no `AuditLogView` component, no `listAuditEvents` query use case, and no `findRecent` repository
read. The trail is now inspected exclusively by direct DB query (operator/forensic access), never
through the app. This deliberately narrows who can see the log — the deployed application exposes no
surface that renders audit history to whoever can reach the board behind the shared gate. Originally
this feature shipped with a minimal read-only `/audit` page (DEC-AU8); that viewer was removed in a
later change-unit — see DEC-AU9 in Decisions and the 2026-07-02 Change Log entry.

This does **not** reintroduce user accounts or principals. The platform has no distinct users
(DEC-P1); it has one shared operator behind a single password gate (DEC-AG1). So "every time a
user did anything" is recorded against a single `operator` actor, enriched forensically with the
request IP and user-agent. See DEC-AU4 — whether the operator should self-identify is flagged as
an open product question for the schema-approval gate.

## Scope

**In**
- A new `modules/audit/` DDD module (domain / application / infrastructure) — the platform-wide home for every audited action.
- An **append-only, immutable** `audit_events` table (Drizzle) in `modules/audit/schema/` — no `deleted_at`, no update path, no delete path (DEC-AU2).
- A structured event shape: `entityType`, `action`, `entityId` (soft link, no FK), `occurredAt`, `actor`, `before`/`after` snapshots (jsonb), optional Croatian `summary`, and `metadata` (jsonb: IP, user-agent, etc.) — see DEC-AU3.
- A `recordAuditEvent` use case (append) in `modules/audit/application/`. _(The `listAuditEvents` query use case that originally shipped alongside it was REMOVED on 2026-07-02 with the viewer — see DEC-AU9.)_
- A `DrizzleAuditEventRepository` exposing **only append + read** methods (no update, no delete) in `modules/audit/infrastructure/`. _(Now exposes `append` + `findByEntity`; the `findRecent` read that fed the viewer was REMOVED on 2026-07-02 — see DEC-AU9.)_
- An `AuditWriter` port in `modules/bookings/application/ports/` and an adapter in `modules/bookings/infrastructure/adapters/` that wraps the audit module's `recordAuditEvent` — the isolation-respecting bridge between the two modules (DEC-AU5).
- Injection of the `AuditWriter` into every bookings mutation use case so each records its own event with before/after: `createBookingUseCase`, `editBookingUseCase`, `cancelBookingUseCase`, `blockScooterUseCase`, `editMaintenanceUseCase` (sibling change-unit), `applyReconciliationUseCase`.
- Capture of request IP + user-agent at the server-action layer, threaded into the audit event metadata (nexus).
- ~~A read-only `/audit` page: nexus data layer (`listAuditEvents`, returns null) → frankie renders a Croatian, reverse-chronological, immutable list.~~ **REMOVED 2026-07-02 (DEC-AU9).** The viewer originally shipped (DEC-AU8) and was then deleted: the `/audit` route (`page.tsx`, `loading.tsx`, `_components/AuditLogView/`) and the footer "Zapisnik" link in `BoardView` are gone. The audit log is now inspected via direct DB query only.

**Out**
- No user accounts, no principals, no `@core/auth` / `@core/identity` / `@core/iam` usage for attribution. DEC-P1 and DEC-AG1 stand — the actor is the single shared `operator` (DEC-AU4).
- No editing, deleting, redacting, or soft-deleting of audit events through any code path — the log is immutable (DEC-AU2). This is a documented, deliberate deviation from archie-rules §3 (soft-delete mandatory).
- No retention / purge / archival policy in v1 (events accumulate; a bounded purge can be a later additive concern — not this change-unit).
- No audit of read/query actions (viewing the board, viewing this log) — only state-changing actions and, if cleanly wired, auth events (DEC-AU7).
- No in-app viewer of any kind (DEC-AU9, supersedes DEC-AU8). The audit log is **not** rendered anywhere in the deployed application — no list, no filtering/search UI, no analytics, no export. It is read exclusively via direct database query (operator/forensic access). Any future in-app viewer would be a new, deliberately-scoped change-unit, not a revival of the removed one.
- No change to the bookings availability math, `fits()` semantics, IDs, or existing behavior — the audit write is additive, after a successful mutation.
- No cross-module transaction machinery beyond what DEC-AU6 records; a shared atomic transaction is preferred-if-clean but not mandated by this SPEC.

## Decisions

1. **DEC-AU1 — Dedicated `modules/audit/` module, not a bookings sub-feature.** The audit log is a platform-wide cross-cutting concern that must eventually house every kind of action (reservation mutations now; auth/login and future non-booking events later). It is therefore its own DDD module with `domain/` / `application/` / `infrastructure/` layers, sitting in `modules/` alongside `bookings/`. **Rejected:** an audit table inside `modules/bookings/` (has nowhere to put auth/login or future non-booking events; conflates the reservation domain with a general-purpose trail; couples the audit log's lifetime to one feature). **Why:** future-proof, houses every action type, and respects module isolation (project-structure §2, ddd-architecture §2). Earned by the operator's phrasing — "all actions on the platform," not "all reservation actions."

2. **DEC-AU2 — Append-only, immutable `audit_events` table; a documented deviation from archie-rules §3. (RESOLVED 2026-07-02 — human chose "DB trigger + app append-only" at the schema-approval gate.)** The table has **no `deleted_at`, no update path, and no delete path**. archie-rules §3 normally mandates soft-delete on every table; an audit log is the deliberate exception — soft-delete would let entries be hidden, which defeats the purpose. This deviation is recorded here so the auditor and archie treat it as intentional, not an oversight. **Resolved on 2026-07-02:** the belt-and-suspenders question — application-level append-only alone, or additional DB-level hardening? — was decided by the human in favour of **BOTH layers**. (a) **DB-level hardening:** a `BEFORE UPDATE OR DELETE` trigger on `audit_events` `RAISE`s an exception on any mutation attempt, so immutability holds against raw SQL and future bugs **regardless of DB role or connection**. This trigger ships as a **separate custom Drizzle migration** (hand-authored SQL, not a `drizzle-kit push`-generated diff). (b) **App-level append-only:** the repository additionally exposes **only append + read** methods — no update, no delete. **Rejected:** app-level append-only alone (holds only for code that goes through the repository — a raw SQL statement or a future bug could still mutate); DB hardening alone (loses the clean append+read repository surface that makes the intent obvious in code); the standard soft-delete lifecycle (breaks immutability — a hidden row is a rewritten history); allowing UPDATE for "corrections" (a corrected audit log is not an audit log — corrections are themselves new events). **Why:** immutability is the entire point of an audit trail (architecture.md §2 — the trust boundary; the log is the record of record), and defence in depth at both the DB and app layers is the strongest guarantee the record cannot be quietly rewritten.

3. **DEC-AU3 — Structured, queryable event shape (not a single free-text event string). (ID strategy RESOLVED 2026-07-02 — human chose "cuid2 (install dependency)" at the schema-approval gate.)** Each `audit_events` row records: `id` (**cuid2 via `@paralleldrive/cuid2`** — this new module follows archie-rules §2.V for new modules, NOT bookings' legacy nanoid; `@paralleldrive/cuid2` is **not currently installed** and must be **added as a dependency** as a prerequisite of T1/T2; **rejected nanoid** — reserved for the legacy bookings module, not for new modules per §2.V); `occurredAt` (timestamptz, equal to `createdAt`); `entityType` (what was acted on: `reservation | maintenance | reconciliation | auth | system`); `action` (a controlled vocabulary — `create | edit | cancel | apply | login_success | login_failure` — typed as a TS union; the exact DB representation, pgEnum vs text, is archie's call in the Minimal Change Report); `entityId` (a soft link to the affected `bookings` row — plain text, **NO foreign key**, per archie-rules §2.IV cross-module soft link; nullable for events with no single entity, e.g. a batch reconciliation or an auth event); `summary` (short human-readable Croatian description, optional); `before` (jsonb, entity snapshot pre-change, null on create); `after` (jsonb, entity snapshot post-change, null on hard-removal-style events); `metadata` (jsonb: actor context — IP, user-agent, and anything else forensically useful). **Rejected:** a single dotted free-text `event_type` field only, e.g. `"reservation.edit"` (loses queryability by entity/action; strings-as-domain-vocabulary is exactly what donnie-rules §6.9 warns against — magic strings); logging only a human message with no snapshots (cannot reconstruct what actually changed). **Why:** structured, queryable, and snapshot-capturing so "what did this reservation look like before the edit?" is answerable.

4. **DEC-AU4 — Actor identity = the single shared `operator` + request metadata. (RESOLVED 2026-07-02 — human chose "anonymous operator + IP/UA" at the schema-approval gate.)** There are no user accounts and no principals (DEC-P1, DEC-AG1), so there is no per-user identity to record. The actor is recorded as an `actor` text column defaulting to `'operator'` (the single shared login), enriched forensically with the request IP + user-agent captured in `metadata` at the server-action layer (nexus). **Resolved on 2026-07-02:** the open product question — should operators self-identify (enter initials/name at login or per action), or is an anonymous `'operator'` actor + request metadata sufficient? — was decided by the human in favour of the **anonymous shared `operator` + request IP/user-agent in metadata**. Operators do **not** self-identify in v1. Because the `actor` column is plain text, it can carry richer values later (real per-operator identity) with **zero schema change** whenever self-identification is added. **Rejected:** operator self-identification in v1 (unnecessary friction for a handful of trusted operators; the text column keeps the door open for free); reintroducing user accounts / principals purely for attribution (directly contradicts DEC-P1; reintroduces exactly the machinery the platform deliberately removed; over-built). **Why:** the minimum that fits the no-accounts architecture, forensically useful via IP/user-agent, and cleanly upgradeable if the human wants real attribution later.

5. **DEC-AU5 — Audit writes happen INSIDE each mutation use case via an injected `AuditWriter` port.** After a successful mutation, each bookings use case records its own audit event through an injected `AuditWriter` port (defined in `modules/bookings/application/ports/`, implemented by an adapter in `modules/bookings/infrastructure/adapters/` that wraps the audit module's public `recordAuditEvent` use case). Cross-module communication goes through a port, never a hard import (donnie-rules §6.4, ddd-architecture §2 module isolation). The use case is where `before`/`after` are naturally available (it holds the entity pre- and post-mutation). **Rejected:** writing the audit event from the server action (server-actions.md §2 forbids multi-use-case orchestration in an action — an action is a thin five-step adapter, not an orchestrator); a dedicated per-action orchestration use case that calls mutate-then-audit (multiplies use cases and duplicates the mutation surface). **Why:** the audit belongs with the domain action, captures before/after for free, and the port keeps module isolation intact so `bookings` never hard-imports `audit` internals.

6. **DEC-AU6 — Atomicity trade-off: audit write after successful mutation, loud CRITICAL log on failure (make it explicit).** The ideal is that no mutation can commit without its audit event in the same transaction. But cross-module transaction sharing (the bookings DB handle vs the audit DB handle — both on one `DATABASE_URL`) is architecturally awkward under strict module isolation. **Decision:** the audit write is called after the successful mutation; if it throws, the use case logs a **CRITICAL structured error** (never silent — for forensic reconstruction) and, by default recommendation, **still returns success for the user's action** (the action genuinely happened — failing the user's booking because the audit sink hiccupped would be worse). The exact fail-open-vs-fail-closed choice is left for **donnie to implement and the human to confirm**; the default is fail-open-with-loud-log. **donnie should first explore whether a single shared transaction across both tables is cleanly achievable** (both tables live in one Postgres DB on one `DATABASE_URL`) — **if it is clean, prefer the atomic path.** **Accepted residual risk:** a mutation without an audit row is possible only if the audit DB write fails, and that gap will always be loudly logged (never swallowed). **Rejected:** silent best-effort audit (violates "a record of EVERYTHING" — a silently-dropped event is an invisible hole in the trail; architecture.md §5/§7 — never swallow errors); hard-failing the user's mutation on any audit-write failure without exploring the atomic path first (punishes the user for an infrastructure hiccup). **Why:** pragmatic for a favour-grade single-instance tool, with the residual risk documented and always logged, and a clear instruction to prefer true atomicity if it is clean (architecture.md §6 idempotency-adjacent, §12 pragmatism, §16 make-the-implicit-explicit).

7. **DEC-AU7 — Audit scope: all reservation/maintenance/reconciliation mutations in; auth events in-if-clean.** In-scope actions to capture: `reservation.create/edit/cancel`, `maintenance.create/edit/cancel`, `reconciliation.apply`. Auth/login events (`login_success` / `login_failure`) are **in scope IF cleanly wired** — but the login action currently uses `lib/auth.ts` helpers directly (not a use case), so cleanly auditing login may require a thin refactor. **If auditing login would bloat this change-unit, mark auth-event auditing as a fast-follow and say so** rather than forcing it. **Rejected:** auditing everything including reads (viewing the board is not a state change; would flood the log with noise); dropping auth events entirely (the operator's "every time a user did anything" points at login as a nice-to-have). **Why:** "every reservation creation/edit/removal" is the explicit must-have; auth events are the "every time a user did anything" nice-to-have, gated on a clean wiring.

8. **DEC-AU8 — A minimal read-only viewer at `/audit`. (SUPERSEDED 2026-07-02 by DEC-AU9 — the viewer was built, then removed.)** An audit log you cannot inspect is half a feature. In scope: a `listAuditEvents` query use case (paginated, bounded — donnie-rules §2, no unbounded queries) and a simple read-only `/audit` page (nexus data layer returns null → frankie renders a Croatian, reverse-chronological, immutable list showing entityType / action / summary / time / actor). Keep it minimal — capture is the must-have, the viewer is its companion. **Rejected:** no viewer at all (leaves the data write-only and opaque — the operator cannot answer "what happened?"); a rich filter/search/export UI in v1 (out of proportion for the first pass — architecture.md §9 no premature work). **Why:** the operator needs to actually read the trail, and reverse-chronological is the natural default for an event log. **Superseded:** this viewer shipped and was subsequently removed — see DEC-AU9. AC-6 (the readable `/audit` trail) is retired with it.

9. **DEC-AU9 — Remove the in-app audit viewer; the log is operator-only via direct DB access. (Supersedes DEC-AU8; reverses the viewer half of the feature only.)** The `/audit` GUI that DEC-AU8 introduced has been removed. **What was deleted:** the `/audit` route (`app/audit/page.tsx`, `loading.tsx`, `_components/AuditLogView/`), the `listAuditEvents` query use case + its capability sidecar, the `findRecent` method on `IAuditEventRepository` and its Drizzle implementation, and the footer "Zapisnik" link (+ now-unused `next/link` import) in `BoardView`. **Intent:** the audit log is operator-only, inspected via direct database access; there is deliberately **no in-app viewer** so that the trail is not exposed through the UI to whoever can reach the board behind the single shared gate (DEC-P1 / DEC-AG1 — one coarse shared-password gate, no per-user identity, so any authenticated session would otherwise have seen the whole history). Removing the viewer narrows visibility of the log to those with direct DB credentials. **This reverses/supersedes DEC-AU8** (the viewer) only. It does **NOT** touch DEC-AU2 (append-only / immutable — still valid), DEC-AU3 (structured event shape — still valid), or the recording path (DEC-AU5/AU6/AU7 — all still valid): every mutation and auth event is still recorded exactly as before. **Rejected:** keeping the viewer (exposes the full trail through the UI to any gated session — the very visibility the operator wanted to close); gating the viewer behind a second credential / role (reintroduces the per-user identity machinery DEC-P1/DEC-AG1 deliberately removed — over-built for a single-operator favour tool); a read-only export button instead of a page (still an in-app surface that renders history — same visibility problem, less useful than a DB query). **Why:** the recording is the record of record and must stay; the viewer was a convenience that turned out to leak the trail to anyone past the shared gate, and direct DB access is the correct forensic/operator surface for a single-instance tool with no user accounts.

## Acceptance Criteria

<!--
Plain-English observable checks. Documentation of intent — the auditor does not run them.
These ACs are advisory. There is no functional verifier / automated prover in this phase, so
each is satisfied by review + code inspection, not by an automated behavior probe.
-->

- [ ] **AC-1 — Reservation mutations are recorded.** Every reservation create / edit / cancel produces exactly one audit event, with `before`/`after` snapshots as applicable (create → `before` null; cancel/edit → both populated).
- [ ] **AC-2 — Maintenance mutations are recorded.** Every maintenance create / edit / cancel produces exactly one audit event (edit-maintenance is the sibling change-unit; the same AuditWriter injection covers it).
- [ ] **AC-3 — Reconciliation is recorded.** Applying a reconciliation proposal produces an audit event capturing the shifts (which reservations moved and to when).
- [ ] **AC-4 — The log is immutable.** Audit events cannot be updated or deleted through any application code path — the repository exposes append + read only; there is no `deleted_at`, no update method, no delete method.
- [ ] **AC-5 — The event is fully structured.** Each audit event records `entityType`, `action`, `entityId` (where applicable), `occurredAt` timestamp, `actor`, and request metadata (IP / user-agent).
- [ ] ~~**AC-6 — The trail is readable.** The `/audit` page lists events reverse-chronologically, read-only, in Croatian.~~ **RETIRED 2026-07-02 (DEC-AU9).** The in-app viewer was removed; the trail is now readable only via direct DB query. This AC no longer applies to the deployed application.
- [ ] **AC-7 — Audit-write failure is never silent.** If an audit write fails, the failure is logged as a CRITICAL structured event (per DEC-AU6) — it is never swallowed; the gap is always visible in logs.
- [ ] **AC-8 — (If auth auditing lands) login events are recorded.** Login success and login failure each produce an audit event with `entityType='auth'`. (Deferred to a fast-follow if wiring it here would bloat the change-unit — DEC-AU7.)

## Tasks

<!--
Ordered by layer dependency: schema → module → server → UI → review.
Owners per the routing tree. archie owns the schema + Minimal Change Report + user-approval gate;
donnie owns the audit module + the AuditWriter port/adapter + use-case injection; nexus owns
request-metadata capture + the /audit data layer + auth-event wiring; frankie owns the viewer UI;
auditor reviews.
-->

- [ ] **T1 — Design the append-only immutable `audit_events` table** (owner: archie)
  New schema files in `modules/audit/schema/` (`enums.ts` + `audit_events.ts` + `index.ts`). Produce a **Minimal Change Report for USER APPROVAL before any migration** (the archie user-approval gate). The report must address: DEC-AU2 immutability (no `deleted_at`; recommend DB-level UPDATE/DELETE hardening — revoke or trigger — as belt-and-suspenders); DEC-AU3 columns (`id` cuid2, `occurredAt`, `entityType`, `action`, `entityId` soft-link/no-FK, `summary`, `before`/`after` jsonb, `metadata` jsonb); the pgEnum-vs-text choice for `entityType` / `action`; DEC-AU4 `actor` text default `'operator'` (and surface the open product question); cuid2 IDs per archie-rules §2.V. Note whether a local DB reset is required.

- [ ] **T2 — Build the `audit` module + wire the `AuditWriter` into bookings** (owner: donnie)
  In `modules/audit/`: domain types + `IAuditEventRepository` interface (append + read only); `application/recordAuditEvent` use case (append) + `application/listAuditEvents` query use case (paginated, bounded — donnie-rules §2); `infrastructure/repositories/DrizzleAuditEventRepository` exposing **only** append + read (no update, no delete — DEC-AU2/AC-4); capability sidecars. Define the `AuditWriter` port in `modules/bookings/application/ports/` and an adapter in `modules/bookings/infrastructure/adapters/` wrapping the audit module's public `recordAuditEvent`. **Inject `AuditWriter` into ALL bookings mutation use cases** — `createBookingUseCase`, `editBookingUseCase`, `cancelBookingUseCase`, `blockScooterUseCase`, `editMaintenanceUseCase` (sibling change-unit), `applyReconciliationUseCase` — so each records its event with `before`/`after` (DEC-AU5). Implement the DEC-AU6 failure handling (loud CRITICAL log; default fail-open; first explore a clean shared transaction and prefer it if achievable). Register capability names / effects if the prover requires.

- [ ] **T3 — Capture request metadata + build the `/audit` data layer + auth wiring** (owner: nexus)
  Capture the request IP / user-agent for actor metadata at the server-action layer (`app/actions.ts`) and thread it into the audit write. Build `app/audit/page.tsx` as a server component that calls `listAuditEvents` and returns `null` (frankie fills the JSX in T4). Wire auth-event auditing (`login_success` / `login_failure`) IF it is clean (DEC-AU7) — the login action currently uses `lib/auth.ts` directly, so if a clean wiring needs more than a thin touch, mark auth auditing as a fast-follow and record that in the Change Log rather than forcing it. (editMaintenance's server action lives in the sibling change-unit, not here.)

- [ ] **T4 — Build the read-only `/audit` viewer UI** (owner: frankie)
  Replace the `null` in `app/audit/page.tsx` with the component tree; create `app/audit/_components/**` — a Croatian, reverse-chronological, immutable list showing `entityType` / `action` / `summary` / `occurredAt` / `actor` for each event, using the existing design system tokens (consistent with the board). Read-only: no edit/delete controls exist (AC-4, AC-6). Reads only the data nexus prepared; never fetches data itself.

- [ ] **T5 — Architectural review of the change-unit** (owner: auditor)
  Pass over the change-unit against `architecture.md` (esp. §2 trust boundary / immutability, §5 Result types, §6/§7 never-swallow-errors + structured signals, §9 no premature work, §12 pragmatism, §16 make-the-implicit-explicit), `project-structure.md`, `ddd-architecture.md` (module isolation, the port between bookings and audit), `archie-rules.md` (the documented DEC-AU2 soft-delete deviation, cuid2 IDs, soft-link no-FK), `donnie-rules.md` (bounded queries §2, ports §6.4, no magic-string vocabulary §6.9), `server-actions.md` (the audit write is NOT in the action — DEC-AU5), plus `page-architecture.md` / `server-first-react.md` / `react-components.md` / `nexus-rules.md` / `frankie-rules.md` for the `/audit` route. Specific checks: the repository exposes no update/delete path (DEC-AU2/AC-4); cross-module contact is via the `AuditWriter` port only, never a hard import (DEC-AU5); audit-write failure is logged CRITICAL and never swallowed (DEC-AU6/AC-7); `entityType`/`action` are a typed vocabulary, not free strings (DEC-AU3); `entityId` is a soft link with no FK (archie-rules §2.IV); the actor posture introduces no principals/DB accounts, so DEC-P1/DEC-AG1 are augmented not violated (DEC-AU4).

## Change Log

<!-- ADD / MOD / DEL prefix; appended by implementing agents as work lands. -->

2026-07-02  donnie  T2 done. DEC-AU6 atomicity decision: FAIL-OPEN with loud CRITICAL log (not atomic). Both modules share one DATABASE_URL but each owns a separate NodePgDatabase/Pool instance. Sharing a transaction across module boundaries would require coupling the two db handles at init time, which violates module isolation (ddd-architecture §2). The cost of atomicity here is higher than the residual risk (a booking without an audit row only when the audit DB write specifically fails — always loudly logged, never swallowed per DEC-AU6 and architecture.md §5/§7). This decision is noted in each mutation use case header.
  ADD  modules/audit/domain/types.ts — AuditEntityType, AuditAction, AuditEvent, AuditContext, RecordAuditEventInput, AuditError (domain pure; mirrors schema tuples without importing schema)
  ADD  modules/audit/domain/repository.ts — IAuditEventRepository: append + findRecent + findByEntity only (no update/delete — DEC-AU2/AC-4)
  ADD  modules/audit/application/auditError.ts — auditErr() factory (mirrors bookingErr pattern)
  ADD  modules/audit/application/recordAuditEventUseCase.ts — makeRecordAuditEventUseCase factory + pre-wired recordAuditEvent; id generated via createId() in use case (matches bookings nanoid-in-usecase pattern); actor defaults to 'operator' (DEC-AU4)
  ADD  modules/audit/application/recordAuditEventUseCase.capability.ts — sidecar; effect: audit.event.appended
  ADD  modules/audit/application/listAuditEventsUseCase.ts — makeListAuditEventsUseCase factory + pre-wired listAuditEvents; default limit 50, hard cap 200 (donnie-rules §2 bounded)
  ADD  modules/audit/application/listAuditEventsUseCase.capability.ts — sidecar; query: true, effects: []
  ADD  modules/audit/infrastructure/database.ts — getAuditDatabase() singleton (mirrors bookings pattern, same DATABASE_URL)
  ADD  modules/audit/infrastructure/repositories/DrizzleAuditEventRepository.ts — makeAuditEventRepository + pre-wired auditEventRepository; append/findRecent/findByEntity only (no update/delete); jsonb blobs never logged at info level (donnie-rules §8)
  ADD  modules/bookings/application/ports/auditWriter.ts — AuditWriter port + AuditWriteInput type; imports AuditEntityType/AuditAction/AuditContext from audit domain public types (the §6.4 allowed seam)
  ADD  modules/bookings/infrastructure/adapters/auditWriterAdapter.ts — makeAuditWriterAdapter + pre-wired auditWriter; wraps audit module's public recordAuditEvent use case (the §6.4 firewall); throws on Result failure so use case applies DEC-AU6 fail-loud semantics
  MOD  modules/bookings/application/createBookingUseCase.ts — inject AuditWriter dep; add optional context: AuditContext to input; audit record after successful save (entityType=reservation, action=create, before=null, after=booking, summary='Rezervacija stvorena'); DEC-AU6 fail-open with CRITICAL log
  MOD  modules/bookings/application/editBookingUseCase.ts — inject AuditWriter; add context; audit record after update (entity=reservation, action=edit, before/after populated, summary='Rezervacija promijenjena')
  MOD  modules/bookings/application/cancelBookingUseCase.ts — inject AuditWriter; add context to CancelBookingInput; audit record with entityType=booking.kind (reservation or maintenance), action=cancel, Croatian summary per kind
  MOD  modules/bookings/application/blockScooterUseCase.ts — inject AuditWriter; add context; audit record (entity=maintenance, action=create, summary='Nedostupnost / kvar zabilježen')
  MOD  modules/bookings/application/applyReconciliationUseCase.ts — inject AuditWriter; add context to input; ONE batch audit event per reconciliation (entity=reconciliation, action=apply, entityId=null, before=proposal changes, after=applied shifts, summary='Uskađivanje primijenjeno')

2026-07-02  spec  RESOLVED three open schema-approval-gate questions (human decisions, DEC-*-resolved-on-date convention):
  - DEC-AU4 (actor identity) → anonymous shared `operator` + request IP/user-agent in metadata; operators do NOT self-identify in v1; the `actor` text column can carry richer values later with zero schema change.
  - DEC-AU2 (immutability) → BOTH DB-level hardening AND app-level append-only: a BEFORE UPDATE/DELETE trigger on `audit_events` RAISEs on any mutation (holds against raw SQL / future bugs regardless of DB role), shipped as a SEPARATE custom Drizzle migration; the repository additionally exposes only append + read.
  - DEC-AU3 (ID strategy) → cuid2 via `@paralleldrive/cuid2` (dependency to be ADDED — not currently installed), per archie-rules §2.V for new modules; NOT nanoid.
2026-07-02  spec  archie's Minimal Change Report presented and APPROVED by the human (schema-approval gate). Schema is purely additive — CREATE TYPE / CREATE TABLE / CREATE INDEX + the immutability trigger; no local DB reset required; zero-downtime on Neon. Prerequisites: add `@paralleldrive/cuid2` dependency, and update `drizzle.config.ts` to include the audit schema barrel.
2026-07-02  archie  T1 done (post-approval implementation). ADD dependency `@paralleldrive/cuid2@^3.3.0` (package.json + pnpm-lock). ADD `modules/audit/schema/{enums,auditEvents,index}.ts` — append-only immutable `audit_events` (cuid2 `$defaultFn(createId)` PK; `occurred_at` timestamptz doubling as created_at; `entity_type`/`action` pgEnums via const-tuple pattern; `entity_id` text soft link, NO `.references()`; `actor` text NOT NULL default 'operator' per resolved DEC-AU4; `summary`/`before`/`after`/`metadata` nullable jsonb; NO `updated_at`/`deleted_at` — documented DEC-AU2 deviation from archie-rules §3/§2.IX). Index names corrected to §2.VII: `idx_audit_events_occurred_at` (DESC) + `idx_audit_events_entity_id`. ADD `drizzle.audit.config.ts` (audit-scoped, module-local `out=modules/audit/schema/migrations`) + `db:generate:audit`/`db:migrate:audit` scripts — a SEPARATE config, NOT an edit to bookings' `drizzle.config.ts`: a single Drizzle `Config` has one `out`, so merging both barrels would write audit DDL into and mutate the bookings-owned journal (clobbering it + breaking module isolation). Bookings migrations dir verified byte-identical before/after (untouched). GENERATED (offline, no DB) `0000_modern_the_enforcers.sql` (CREATE TYPE x2 + CREATE TABLE `audit_events` + 2 CREATE INDEX). AUTHORED custom `0001_audit_events_immutability_trigger.sql` (belt-and-suspenders DB-level immutability: `audit_events_reject_mutation()` + BEFORE UPDATE/DELETE/TRUNCATE triggers — DEC-AU2/AC-4; separate custom migration per archie-rules §5, NOT a hand-edit of generated table SQL). tsc clean; re-`generate` reports "no schema changes" (no drift). NO migration APPLIED — generate-only; `migrate`/`push` is the deploy step, out of archie scope (archie-rules §5, infra-commandments §4/§5). App-level append-only repository (only append + read, no update/delete) remains donnie's job in T2.

2026-07-02  nexus  T3 done. Request metadata capture + /audit data layer + auth event wiring.
  MOD  app/actions.ts — ADD `context: await auditContext()` to `blockScooter({...})` call (~L408, previously missing); ADD `context: await auditContext()` to `applyReconciliation({...})` call (~L771, previously missing). All five mutation use-case calls now carry forensic context. Query actions (computeAvailability, computeOpenSlots, proposeReconciliation) unchanged — read-only, no audit context needed. ADD `editMaintenanceAction` (DEC-EM4): five-step shape; id required, quantity/startTimeMs/endTimeMs/notes optional; dates as epoch-ms → new Date(ms); notes empty→null (clear), absent→undefined (no change), mirrors editBookingAction; calls editMaintenance({ id, quantity, startTime, endTime, notes, context: await auditContext() }); revalidatePath('/') on success.
  ADD  app/audit/page.tsx — read-only audit-log data layer; `export const dynamic = 'force-dynamic'`; awaits searchParams (Next.js 16 pattern); parses + clamps limit (default 50, max 200) and offset; calls listAuditEvents({ limit, offset }) in Promise.all; throws on failure (renders error.tsx); returns null (frankie replaces in T4). HANDOFF comment describes <AuditLogView events limit offset> component, Date-typed props (no epoch-ms serialization — server component tree), Croatian labels.
  ADD  app/audit/loading.tsx — skeleton (returns null); frankie styles in T4.
  MOD  app/login/actions.ts — ADD loginAuditContext() local helper (mirrors auditContext; cannot import across sibling action files without a shared module); ADD `recordAuditEvent` import from audit module; WIRE auth event auditing: login_failure records { entityType:'auth', action:'login_failure', summary:'Neuspješna prijava' } (awaited, fail-open — use case internally catches and returns Result); login_success records { entityType:'auth', action:'login_success', summary:'Prijava uspješna' } awaited before redirect() since redirect() throws NEXT_REDIRECT; NOT_CONFIGURED skips audit (system not operational — no signal value). Login auditing WIRED (not deferred). Password value NEVER logged or stored (architecture.md §2 / donnie-rules §8).

2026-07-02  spec  AUDIT LOG GUI REMOVED — audit log is now operator-only via direct DB access (DEC-AU9, supersedes DEC-AU8). The RECORDING path is intentionally preserved end-to-end; only the in-app VIEWING surface is gone. Intent: do not expose the trail through the UI to whoever reaches the board behind the shared gate (DEC-P1/DEC-AG1). AC-6 retired; DEC-AU2/AU3 and the recording chain (DEC-AU5/AU6/AU7) remain valid.
  DEL  app/audit/page.tsx — viewer data layer removed
  DEL  app/audit/loading.tsx — viewer skeleton removed
  DEL  app/audit/_components/AuditLogView/AuditLogView.tsx — viewer component removed (app/audit/ directory now gone)
  DEL  modules/audit/application/listAuditEventsUseCase.ts — paginated query use case that fed the viewer removed (no other caller)
  DEL  modules/audit/application/listAuditEventsUseCase.capability.ts — its capability sidecar removed
  MOD  app/_components/BoardView/BoardView.tsx — removed footer "Zapisnik" link to /audit and the now-unused `import Link from 'next/link'`
  MOD  modules/audit/domain/repository.ts — removed `findRecent` from IAuditEventRepository (interface now: append + findByEntity)
  MOD  modules/audit/infrastructure/repositories/DrizzleAuditEventRepository.ts — removed the `findRecent` method implementation (matches interface — no half-migrated surface)
  PRESERVED (unchanged): recordAuditEvent use case + capability sidecar, append(), schema (modules/audit/schema/), domain/types, auditError, getAuditDatabase singleton, and all recording callers — app/actions.ts, app/login/actions.ts, modules/bookings/infrastructure/adapters/auditWriterAdapter.ts (injected into all 6 bookings mutation use cases).

2026-07-03  spec  Open Follow-ups FU-1 and FU-2 resolved (schema layer).
  MOD  modules/audit/schema/auditEvents.ts — FU-1: stale "/audit viewer" comments (≈L70, L85) updated to reflect DB-query-only / direct-SQL access (architecture.md §8 — comments match post-edit reality). Applied.
  KEEP  modules/audit/schema/auditEvents.ts (idx_audit_events_occurred_at) — FU-2: decision to KEEP the `occurred_at DESC` index. Audit access is direct-SQL only (DEC-AU9); `ORDER BY occurred_at DESC` is the natural forensic query, so the index earns its place (archie-rules §2.VI). No migration.

## Open Follow-ups

<!--
Non-blocking items surfaced by the auditor that fall OUTSIDE this change-unit's edits.
These are ARCHIE's territory (schema layer) — recorded here so they are not lost.
The spec agent does not fix these; a future archie change-unit should.
-->

- [x] **FU-1 — Stale schema comments (owner: archie). RESOLVED 2026-07-03.** `modules/audit/schema/auditEvents.ts` (≈lines 70 and 85) previously carried comments referencing "the /audit viewer", which no longer exists after DEC-AU9. Those stale comments have been **fixed** (updated to reflect DB-query-only / direct-SQL access). architecture.md §8 satisfied — comments now match post-edit reality.
- [x] **FU-2 — `idx_audit_events_occurred_at` index (owner: archie). RESOLVED 2026-07-03 — decision: KEEP.** The `occurred_at DESC` index was originally justified by the paginated `/audit` viewer read (DEC-AU8), which is gone. **Decision:** KEEP the index. Audit access is now direct-SQL only (per DEC-AU9), and `ORDER BY occurred_at DESC` is the natural forensic query an operator runs against the trail, so the index earns its place (archie-rules §2.VI — index where queries hit). No migration required.

<!-- AUTO:WORKLOG — appended (never overwritten) by the auditor on every run -->
## Worklog

2026-07-02  spec  drafted SPEC (silent mode) for the platform-wide immutable audit log — new `audit` module folder; captures DEC-AU1..DEC-AU8, 8 ACs, 5 tasks. Cross-links the sibling edit-maintenance change-unit (editMaintenance must also emit an audit event via the AuditWriter injection). Flags DEC-AU4 (actor identity) as an open product question for the schema-approval gate, and DEC-AU2 as a deliberate documented deviation from archie-rules §3.

2026-07-02  auditor  engineering review  PASS with notes  Immutability holds end-to-end (append+read-only interface/repo, no deleted_at/updated_at documented, BEFORE UPDATE/DELETE/TRUNCATE trigger); cross-module seam clean (only domain/types + public use case); DEC-AU6 fail-open uniform across all 6 mutation use cases with loud logs; no secret/password in any audit field or log. Notes: prover unwired (central registration moot), UI under-exposes DEC-EM2, unused `total` prop, "CRITICAL" wording vs .error.

2026-07-02  auditor  delta re-audit  PASS with notes  Two frankie remediations verified RESOLVED. FIX 1: BookingRow.tsx maintenance edit now gated on isMaintenanceEditable (kind=maintenance && status!='cancelled' && endTime>now) — exact mirror of domain canEditMaintenance and consistent with the row's cancel gate; guard is isPending || isMaintenanceEditable; reservations unchanged (future-only); pure prop-derived, no hooks/Date.now, uses injected now; routes to MaintenanceEditContainer; no regression on past/cancelled/reservation rows. Prior frankie-rules DEC-EM2 concern CLEARED. FIX 2: AuditLogView.tsx destructures + displays `total`; still a pure server component, tokens/a11y intact — prior architecture §8 dead-prop note CLEARED. No new violations (react-components / server-first-react / frankie-rules clean). One awareness note: inert `total < 5 ? 'zapisa' : 'zapisa'` ternary (both branches identical). tsc GREEN.

2026-07-02  auditor  engineering review (Audit Log GUI removal)  PASS with notes  Removal is clean. DELETED app/audit/** (page, loading, AuditLogView; dir gone) + modules/audit/application/listAuditEventsUseCase.ts + .capability.ts. EDITED BoardView.tsx (dropped footer Link + now-unused next/link import), audit domain/repository.ts and DrizzleAuditEventRepository.ts (dropped findRecent from interface AND impl together — no half-migrated interface). Recording path VERIFIED intact end-to-end: recordAuditEvent use case + sidecar untouched; login/actions.ts auth events still recorded; auditWriterAdapter still wraps recordAuditEvent, injected into all 6 bookings mutation use cases; schema/domain types/auditError/database singleton untouched. Zero orphans: no repo hits for listAuditEvents/findRecent/AuditLogView, no dangling import of the deleted use case, tsc GREEN. Notes: (1) schema/auditEvents.ts comments still reference "the /audit viewer" (stale, §8) and (2) idx_audit_events_occurred_at was justified solely by the now-removed paginated viewer — now serves no in-repo read (archie's call, §8 / archie-rules §2.VI); (3) findByEntity remains callerless but that is PRE-EXISTING, not introduced here; (4) BoardView removal clean. Both schema-comment/index notes fall in archie's territory — reconcile via archie/spec, not blocking.

<!-- /AUTO:WORKLOG -->

<!-- AUTO:VERDICT — overwritten by the auditor on every run -->
## Verdict
**PASS with notes** · 2026-07-02T00:00:00Z  (Audit Log GUI removal — recording path preserved)

This change-unit removes the Audit Log GUI while preserving the audit-event RECORDING path. It is a clean removal: no violations, no concerns, four notes (two of which land in archie's territory for later reconciliation).

**The removal is complete and orphan-free.** The `/audit` route is fully gone (`page.tsx`, `loading.tsx`, `_components/AuditLogView/AuditLogView.tsx`, and the empty `app/audit/` directory). The single query use case that fed the GUI — `listAuditEventsUseCase.ts` and its `.capability.ts` sidecar — is deleted, correctly avoiding a dead/orphan export (architecture.md §8). The `findRecent` read was removed from BOTH the `IAuditEventRepository` interface (`modules/audit/domain/repository.ts`) AND the Drizzle implementation in the same change-unit — no half-migrated interface, no method left stranded on one side. `app/_components/BoardView/BoardView.tsx` dropped both the footer `<Link href="/audit">` block and the now-unused `import Link from 'next/link'`, so no orphan import remains. A repo-wide grep returns zero hits for `listAuditEvents`, `findRecent`, `AuditLogView`, and `href="/audit"` in `.ts`/`.tsx`; there is no dangling import of any deleted symbol; `tsc --noEmit` is GREEN.

**The recording path is genuinely intact.** `recordAuditEventUseCase.ts` and its capability sidecar are untouched; `app/login/actions.ts` still records `login_success` / `login_failure`; `modules/bookings/infrastructure/adapters/auditWriterAdapter.ts` still wraps `recordAuditEvent` and is injected into all six bookings mutation use cases; the schema, domain types, `auditError`, and the `getAuditDatabase` singleton are all unchanged. AC-1..AC-5 and AC-7 (append + immutability + structured event + never-silent-failure) remain satisfied by construction; only AC-6 (the readable `/audit` trail) is intentionally retired with this change. Layer boundaries are clean — the edited repository still exposes append + read only (now `append` + `findByEntity`), no barrels, no cross-module leakage.

**Notes for follow-up (none blocking, all in archie's territory or pre-existing):**
- `modules/audit/schema/auditEvents.ts` still carries comments referencing "the /audit viewer" (≈L70, L85) — stale relative to the removal (architecture.md §8). The schema is archie-owned and outside this change-unit's edits.
- `idx_audit_events_occurred_at` (the `occurred_at DESC` index) was justified in-comment ENTIRELY by "the dominant read is the paginated /audit viewer (DEC-AU8)". That read no longer exists; the only remaining repository read is `findByEntity`, served by `idx_audit_events_entity_id`. The DESC index is now speculative (architecture.md §8 / archie-rules §2.VI — index where queries hit). Archie should decide whether to keep it for anticipated future reads or drop it.
- `findByEntity` still has no in-repo caller — but this is PRE-EXISTING (it had no caller before this change-unit either) and was deliberately left in scope-adjacent; not introduced by this removal.

Remediation ownership: the two schema notes (stale comment + now-speculative index) belong to **archie** (schema layer). The `findByEntity` callerless note is pre-existing and optional. None require action before commit. The single documentation reference in `system/context/audit/features/audit-log/HANDOFF.yaml` (flagged by the orchestrator) is the **spec** agent's to reconcile.

<!-- /AUTO:VERDICT -->

2026-07-02  frankie  T4 done. Audit log viewer UI (DEC-AU8).
  ADD  app/audit/_components/AuditLogView/AuditLogView.tsx — pure server component; props: events: AuditEvent[], total: number, limit: number, offset: number; renders reverse-chronological immutable list; eventLabel() maps (entityType, action) to Croatian human labels (reservation+create→"Rezervacija stvorena", maintenance+edit→"Nedostupnost promijenjena", reconciliation+apply→"Usklađivanje primijenjeno", auth+login_success→"Prijava", auth+login_failure→"Neuspješna prijava"); formats occurredAt via Intl.DateTimeFormat Europe/Zagreb; read-only (no edit/delete — DEC-AU2/AC-4); empty state in Croatian; prev/next pagination via next/link <Link href>; header with "Nepromjenjivi zapisnik svih radnji na platformi" subtitle; event cards with accent stripe (primary/muted/destructive based on action); actor + entityId metadata.
  MOD  app/audit/page.tsx — ADD AuditLogView import; replace `return null` + void statements with <AuditLogView events={events} total={events.length} limit={limit} offset={offset} /> (frankie-only change: return statement and import); nexus data layer (auth, fetch, error handling) untouched.
  MOD  app/audit/loading.tsx — styled skeleton list: header skeleton + 6 event card placeholders with animate-pulse; replaces nexus null stub.
  MOD  app/_components/BoardView/BoardView.tsx — ADD Link import from next/link; ADD discreet "Zapisnik" footer link to /audit inside rasporedPanel (below ReconciliationContainer); unobtrusive, small text, muted-foreground colour, focus-visible ring.

2026-07-02  frankie  auditor-remediation FIX 2 — resolve dead `total` prop in AuditLogView (auditor note: props declared total but component never destructured/used it).
  MOD  app/audit/_components/AuditLogView/AuditLogView.tsx — ADD total to destructured props; ADD "{total} zapisa" count display in header alongside the page title (Croatian pluralisation; semantic token muted-foreground, tabular-nums, aria-label); eliminates dead-prop lint gap (architecture §8 / tsc noUnusedLocals — object-prop form).
