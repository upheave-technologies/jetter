<!--
SPEC.md — working memory for one change-unit.

Lives at: system/context/bookings/features/today-focus-view/SPEC.md

This is a FRONTEND-ONLY UX refinement of the Reservation Planning Board built by the
sibling change-unit at ../reservation-pivot/SPEC.md (bookings-reservation-pivot). It
adds nothing to the data layer: no new server actions, no new data fetching, no schema
change, no auth change. It reshapes how the existing DayBoard data is presented on the
current day. Frankie's territory.

The temporal model it relies on (PAST / CURRENT / PENDING against board.now) is a
re-reading of facts the reservation-pivot already established — see DEC-P9 there: the
sacred availability core stays the single source of truth and no temporal/fit math is
duplicated. This SPEC fixes a presentation bug introduced under the pivot's pressure
(BookingRow labels in-progress reservations as "in the past") and reduces today-board
clutter.
-->

---
id: bookings-today-focus-view
slug: today-focus-view
module: bookings
type: modification
state: working
created: 2026-06-30
updated: 2026-06-30
---

<!-- AUTO:CARD — overwritten by the auditor on every run -->
## CARD — engineering review · 2026-06-30T00:00:00Z
**verdict** PASS with notes

**Changed files** 6
app/_components/TemporalBadge/TemporalBadge.tsx
app/_components/ShowPastView/ShowPastView.tsx
app/_containers/ShowPastContainer/ShowPastContainer.tsx
app/_components/BookingRow/BookingRow.tsx
app/_components/BookingsList/BookingsList.tsx

**Findings** 0 violations · 0 concerns · 5 notes

### frankie's rules — frankie-rules.md
**Notes**
- BookingRow.tsx:80,210  h-[15px] w-[15px] arbitrary icon sizing — pre-existing, not introduced by this change-unit (§2.1)
- ShowPastView.tsx:39  aria-controls="past-reservations-list" targets an id that only exists when expanded; harmless but not fully correct (§5)
- ShowPastView.tsx:47-49  chevron rotate state via inline ternary rather than CVA — trivial, acceptable (§2.2)

### project-structure — project-structure.md
**Notes**
- app/_containers/ShowPastContainer/  container placed in a folder; frankie-rules §3 prefers containers-as-files. Consistent with repo precedent — flagging only (§3)

### architecture — architecture.md
**Notes**
- TemporalBadge.tsx:75  classifyTemporal is a justified shared helper (2 consumers: BookingRow + BookingsList) — surfacing the §9 check as passed, not a problem
<!-- /AUTO:CARD -->

## Intent

On the **current day**, the operator opens the Reservation Planning Board under pressure at the booth and has to scroll past every reservation that has already finished to reach the ones that still matter. Early in the day this is fine; by late afternoon the list is dominated by dead rows, and the few reservations that are in progress or still coming up are buried. The board's north star — *brutal simplicity and field-grade usability* — is undermined the moment the default view shows mostly history.

This change refines the today view so it defaults to **what is relevant right now**. Reservations whose window has fully ended (PAST) are collapsed behind a "show past / hide past" toggle, hidden by default with a visible count, so the operator sees only in-progress and upcoming work without scrolling. At the same time, the board gains a clear visual **indicator** that distinguishes reservations that are **current** (in progress right now) from those that are **pending** (upcoming, not yet started) — two states that today look identical and read as an undifferentiated wall.

It also corrects a presentation defect carried in from the reservation-pivot: the row currently labels everything that is not strictly future as "Rezervacija u prošlosti" ("reservation in the past"), which is wrong for an in-progress reservation — that one is happening *now*, not in the past. The fix re-reads each row against the server's `now` as one of three temporal states (past / current / pending) and labels and marks it honestly. All of this is presentation only; the commitment data, the availability math, and the day scoping are unchanged.

## Scope

**In**
- On today's board only, split the reservation list into PAST vs CURRENT+PENDING; hide PAST behind a "show past / hide past" toggle that is collapsed by default and shows a count (e.g. "Protekle (N)").
- A clear visual indicator on each row distinguishing CURRENT (in progress now) from PENDING (upcoming), using existing design tokens.
- Fix the mislabel so an in-progress reservation is no longer labeled "in the past."
- Thread the already-available `isToday` flag from the board view down to the list so the collapse behavior can be gated to the current day.
- Apply the same past / current / pending temporal reading to maintenance blocks for consistency, while keeping them in their existing "Nedostupnost / kvar" section (no separate collapse section is required for maintenance).
- A slim new `'use client'` container under `app/_containers/` holding only the ephemeral show/hide-past open/closed state, delegating all rendering to server-component children — the same server-components-as-children-of-a-client-component pattern already used by `BoardTabsContainer`.

**Out**
- No new server actions, no new server-side data fetching, no changes to `app/page.tsx` data loading or `app/actions.ts`. (The DayBoard already carries everything needed, including `now`.)
- No schema change, no migration, no domain/availability change, no use-case change — nothing under `modules/bookings/` is touched.
- No auth, session, middleware, caching, or revalidation changes.
- No client-side clock: every temporal classification uses the server `now` (`board.now`) handed down from the page; the UI never calls `Date.now()` to decide past/current/pending.
- Non-today behavior is unchanged: on a past day every row is past and on a future day every row is pending, so no toggle is shown and all rows render exactly as they do today.
- No change to the day switcher, density chart, utilization panel, slot finder, reconciliation, or maintenance creation flows beyond the row-level temporal indicator described above.
- No change to the `reserved | cancelled` × `reservation | maintenance` model or to cancellation/edit gating (future-only editability stays exactly as the reservation-pivot set it).

## Decisions

1. **DEC-TF1 — The collapse-past toggle applies on the current day only.** The "hide past / show past" split is gated on `isToday`. On a past day every row is already past and on a future day every row is already pending, so a collapse there hides either everything or nothing — meaningless. Non-today days render the full list with no toggle, exactly as before. **Rejected:** always splitting regardless of day (produces a useless or empty "past" section on non-today days and adds a control the operator must reason about for no benefit). **Why:** the clutter problem only exists on today; the simplest fix targets exactly that case.

2. **DEC-TF2 — Three temporal states read from server `now`, not two.** Each row is classified against `board.now` as PAST (`endTime <= now`), CURRENT (`startTime <= now < endTime`), or PENDING (`startTime > now`) — replacing the current binary `isFuture = startTime > now` reading that lumps CURRENT in with PAST. This is the same `[start, end)` half-open boundary the availability core uses (R-AVAIL-3): a reservation whose window has ended exactly at `now` is PAST; one that started exactly at `now` is CURRENT. **Rejected:** keeping the binary split and special-casing the label string only (leaves CURRENT visually indistinguishable from PENDING, which is half the ask); a client-side clock for "live" status (forbidden — drifts from the server truth the whole board is built on, DEC-P9). **Why:** the operator needs to tell "happening right now" from "coming up" at a glance, and the honest three-way reading both fixes the mislabel and powers the indicator from one classification.

3. **DEC-TF3 — Past hidden by default, revealed by an ephemeral client toggle with a count.** On today, PAST reservations are not rendered by default; a toggle ("show past / hide past") reveals them, and the collapsed control shows how many are hidden (e.g. "Protekle (N)") so the operator knows history exists without it taking space. The open/closed state is ephemeral UI state, so it lives in a slim `'use client'` container that delegates rendering to server-component children — mirroring `BoardTabsContainer`, whose state already survives the ~2s `router.refresh()` poll. **Rejected:** a `?showPast=1` URL param / server round-trip (turns a trivial toggle into a navigation and a refetch — over-engineered for ephemeral view state); making the whole list client-side (needlessly enlarges the client surface, violating server-first-react §4 — the rows can stay server components passed in as children). **Why:** the toggle is pure view state; the minimum-client-surface pattern already proven by `BoardTabsContainer` is the right and consistent tool.

4. **DEC-TF4 — Temporal indicator uses existing design tokens; no new color literals.** CURRENT (in progress / live) is marked with the existing `success` (green) treatment; PENDING (upcoming) uses a neutral / `primary` treatment. No new color literals or arbitrary Tailwind values are introduced — the distinction reuses the design system already in the board. **Rejected:** a new bespoke "live" accent color (frankie-rules §2.1 forbids arbitrary color literals; the semantic tokens already carry the right meaning). **Why:** "in progress" maps cleanly onto the success/green semantic the system already owns; consistency beats a new token.

5. **DEC-TF5 — Maintenance gets the same temporal reading, same section.** Maintenance blocks are classified PAST / CURRENT / PENDING by the same rule so a finished or in-progress block reads honestly (the current code mislabels them too — "Blokada u tijeku ili završena" conflates the two states). But maintenance stays in its existing "Nedostupnost / kvar" section and is not pulled into the reservation collapse split. **Rejected:** a parallel collapse section for past maintenance (maintenance volume is low; a second toggle adds control surface for negligible clutter gain). **Why:** consistency of labeling without multiplying controls — the clutter problem is a reservation problem.

## Acceptance Criteria

<!--
Plain-English observable checks. Documentation of intent — the auditor does not
run them. Anchored to board.now so the temporal reading is provably server-driven.
-->

- [ ] **AC-1 — Past hidden by default on today.** On today's board, reservations whose window has fully ended (`endTime <= board.now`) are not shown by default. A "show past" toggle reveals them, and the collapsed control displays the count of hidden past reservations (e.g. "Protekle (N)").
- [ ] **AC-2 — Current is visually distinct from pending.** A reservation that is in progress (`startTime <= board.now < endTime`) carries a visibly distinct indicator (the `success`/green treatment) from a reservation that is upcoming (`startTime > board.now`), so the operator can tell "happening now" from "coming up" at a glance.
- [ ] **AC-3 — In-progress is no longer labeled "in the past."** A reservation whose `startTime <= board.now < endTime` is never labeled "Rezervacija u prošlosti"; only a reservation whose `endTime <= board.now` reads as past.
- [ ] **AC-4 — Non-today is unchanged.** On a past day or a future day, the list renders exactly as before: no show/hide-past toggle appears, and every row is shown.
- [ ] **AC-5 — Server-now only, no client clock.** Every past / current / pending classification is computed from the server `now` (`board.now`) handed down from the page; no component reads `Date.now()` or any client clock to decide temporal state.
- [ ] **AC-6 — Maintenance labeled honestly.** A maintenance block reads as past, in-progress, or upcoming according to the same `board.now` rule, while remaining in its existing "Nedostupnost / kvar" section (no separate collapse).
- [ ] **AC-7 — Minimum client surface.** The only new client component is the slim show/hide-past container holding ephemeral open/closed state; the reservation rows it reveals/hides remain server components passed in as children (mirroring `BoardTabsContainer`).

## Tasks

<!--
Frontend-only change-unit. Owner is frankie throughout, then the auditor.
Ordered so the data thread is in place before the rows that read it.
-->

- [ ] **T1 — Thread `isToday` to the list** (owner: frankie)
  `app/_components/BoardView/BoardView.tsx` already receives `isToday`; pass it through to the reservations list so the list can gate the collapse behavior to the current day (DEC-TF1). No data-layer change — this is prop plumbing within the UI shell.

- [ ] **T2 — Three-state temporal reading + indicator + mislabel fix** (owner: frankie)
  `app/_components/BookingRow/BookingRow.tsx`: replace the binary `isFuture = startTime > now` with a past / current / pending classification against `now` (`board.now`) using `[start, end)` semantics (DEC-TF2). Fix the label so an in-progress row is not "Rezervacija u prošlosti" (DEC-TF3 label, AC-3). Add the temporal indicator: `success` token for CURRENT, neutral/`primary` for PENDING (DEC-TF4, AC-2). Apply the same reading to the maintenance label so a block reads past/in-progress/upcoming honestly (DEC-TF5, AC-6). If the temporal badge is best expressed through `app/_components/StatusPill/StatusPill.tsx`, extend it there with existing tokens only.

- [ ] **T3 — Collapse past behind a slim client toggle** (owner: frankie)
  `app/_components/BookingsList/BookingsList.tsx`: split the reservation rows into PAST vs CURRENT+PENDING using the same classification, but only collapse on the current day (`isToday`); on non-today days render the full list with no toggle (DEC-TF1, AC-4). Add a new slim `'use client'` container under `app/_containers/` (e.g. `ShowPastContainer`) that holds only the ephemeral open/closed state and delegates rendering to server-component children, the way `BoardTabsContainer` does (DEC-TF3, AC-7). The collapsed control shows the past count, e.g. "Protekle (N)" (AC-1). Maintenance stays in its existing section, uncollapsed (DEC-TF5).

- [ ] **T4 — Architectural review** (owner: auditor)
  Pass over the change-unit against `architecture.md`, `project-structure.md`, `react-components.md`, `server-first-react.md`, `page-architecture.md`, plus `frankie-rules.md`. Specific checks: no `Date.now()` / client clock anywhere — all temporal state derives from `board.now` (AC-5, DEC-P9 spirit); the new container is the only added client component and the revealed rows stay server components passed as children (server-first-react §4, AC-7); the temporal indicator uses semantic tokens only, no arbitrary color literals (frankie-rules §2.1, DEC-TF4); no data fetching, server action, or fit/temporal math added to the UI layer (the classification is a simple boundary read on data the board already provides, not duplicated availability math — DEC-P9 of reservation-pivot); non-today behavior is provably unchanged (AC-4).

## Change Log

<!-- ADD / MOD / DEL prefix; appended by implementing agents as work lands. -->

<!-- AUTO:WORKLOG — appended (never overwritten) by the auditor on every run -->
## Worklog

2026-06-30T00:00:00Z  auditor  engineering review  PASS with notes  Server-first toggle pattern sound, semantic tokens, no client clock; 5 low notes (pre-existing arbitrary icon sizing, aria-controls of conditional id, container-as-folder).
<!-- /AUTO:WORKLOG -->

<!-- AUTO:VERDICT — overwritten by the auditor on every run -->
## Verdict
**PASS with notes** · 2026-06-30T00:00:00Z

The change-unit is architecturally clean. The server-components-as-children-of-a-client-component pattern is implemented correctly: `ShowPastContainer` is the only new `'use client'` file, it holds nothing but an ephemeral open/closed boolean, and it delegates all rendering to the pure `ShowPastView`, which receives the past `BookingRow` list as server-rendered `children` — the client surface is minimal (server-first-react §3/§4, AC-7). `classifyTemporal` is a pure boundary read on data the board already provides; it duplicates no availability math and reads server `now` exclusively — no `Date.now()` anywhere (AC-5, DEC-P9 spirit upheld). The three-state classification fixes the mislabel honestly, the temporal indicator uses only semantic tokens (`success`, `primary`, `warning` — all registered in the `@theme` block), and non-today behavior is gated by `isToday` so the full list still renders with no toggle (AC-4). The toggle button is a semantic `<button>` with `aria-expanded`, `aria-controls`, and a `focus-visible:` ring.

No violations and no concerns. Five low notes worth awareness: (1) `BookingRow` still carries `h-[15px] w-[15px]` arbitrary icon sizing on the Wrench/X icons — pre-existing, not introduced here, but the file was touched so it surfaces; a future pass could migrate these to a token; (2) `aria-controls` on the toggle points at an id that only exists in the DOM while expanded — harmless in practice but technically a dangling reference when collapsed; (3) the chevron rotation uses an inline ternary rather than CVA — trivial; (4) `ShowPastContainer` sits in a folder rather than a flat `_containers/{Name}Container.tsx` file (frankie-rules §3), though this matches existing repo precedent; (5) `classifyTemporal` as a shared helper is justified (two consumers) — the §9 check passed.

No remediation required before commit. The notes are frankie's to address opportunistically; none block shipping.
<!-- /AUTO:VERDICT -->
