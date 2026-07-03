<!--
SPEC.md — working memory for one change-unit.

Lives at: system/context/bookings/features/booth-board/SPEC.md

Source of truth for Intent / Scope / Acceptance Criteria: /FSD.md
(translated faithfully — quotes from the FSD where it speaks; flagged as
"implementation decision" where it does not).
-->

---
id: bookings-booth-board
slug: booth-board
module: bookings
type: feature
state: working
created: 2026-06-06
updated: 2026-07-03
---
---

<!-- AUTO:CARD — overwritten by the auditor on every run -->
## CARD — engineering review · 2026-07-03T00:00:00Z (remove 2s board polling · deletion + comment cleanup)
**verdict** PASS with notes    (clean deletion; no orphaned code references; two documentation/cosmetic notes)

**Changed files** 3
app/_containers/BoardSyncContainer/BoardSyncContainer.tsx (deleted)
app/_components/BoardView/BoardView.tsx
app/_containers/ShowPastContainer/ShowPastContainer.tsx

**Findings** 2 notes

- The 2-second polling leaf is fully removed. The `'use client'` file `BoardSyncContainer.tsx` and its directory are deleted; `BoardView.tsx` drops the import, the `<BoardSyncContainer />` mount, and both descriptive comments (the inline mount comment + the ASCII component-tree line); `ShowPastContainer.tsx` rewrites its stale "board polls every 2s" comment to describe the mutation-driven refresh model that is actually in force. `app/page.tsx` (`force-dynamic` + `revalidate = 0`) was intentionally left untouched.

**Mechanical verification:**
- `grep -rn "BoardSyncContainer"` across code (`.ts`/`.tsx`): **zero code hits.** The only surviving reference is `system/context/bookings/features/booth-board/SPEC.md:294` (documentation — spec agent's territory, not code; see note below).
- `grep -rn "router.refresh\|setInterval\|POLL_INTERVAL\|polls every\|2s polling"` across `app/`: **zero hits.** No stranded polling machinery, no orphaned timer, no dead comment referencing polling.
- `BoardView` still consumed — imported and mounted at `app/page.tsx:33,90`. The removal did not strand the view export.
- `ShowPastContainer.tsx:13` `revalidateTag / revalidatePath` reference is **comment-only** (verified — not a call inside the client component). The rewritten comment matches reality: `app/actions.ts` performs the actual `revalidateTag`/`revalidatePath` calls, and `page.tsx` is `force-dynamic` / `revalidate = 0`, so server data re-fetches after each mutation's revalidation. The claim that `useState` survives a server refresh (and the toggle persists) is correct.

### architecture — architecture.md
- No issues. §8 no half-finished work: this is a complete removal, not a half-migration — the deleted file, its directory, the import, the JSX mount, and every descriptive comment referencing it are gone in a single change-unit; no dead exports, no orphaned imports, no stale comment survives in code. §10 code is communication / §17 empathy for future maintainers: the `ShowPastContainer` comment was corrected rather than left lying — a stale comment claiming a behavior that no longer exists is the exact debt these mindsets forbid; the rewrite names the real refresh model (mutation-driven `revalidateTag`/`revalidatePath` over a `force-dynamic` page) and retains the DEC-TF3 rationale fossil.

### react-components — react-components.md
- No issues. §4 boundary: `BoardView.tsx` remains a pure presentational `_components/` server file — the edit only removed an import + a JSX node + comments; no hook was introduced, no `'use client'` added, still props → JSX. `ShowPastContainer.tsx` stays a legitimate slim `'use client'` state proxy (`useState` only, delegates all rendering to `ShowPastView`) — comment-only edit, behavior untouched. §2 forbidden imports: nothing added; the removed `BoardSyncContainer` import (and with it the last `useEffect` in the project) reduces surface, it does not add it.

### server-first-react — server-first-react.md
- No issues. §4 minimum client surface: deleting the polling leaf strictly *reduces* shipped client JavaScript — the project's only `useEffect`-based client leaf is gone. This moves with the principle, not against it. `BoardView` remains server-first; `ShowPastContainer` remains the smallest necessary client leaf.

### frankie's rules — frankie-rules.md
- No issues. No design-system, accessibility, or performance surface touched — the change is a deletion plus two comment edits. No tokens, no images, no interactive controls added or altered. §3 file organization: the now-empty `BoardSyncContainer/` directory was removed alongside its file (no orphaned atomic folder left behind).

**Notes (surfaced for the orchestrator — neither tilts the verdict past PASS-with-notes):**
- `system/context/bookings/features/booth-board/SPEC.md:294` still describes `_containers/BoardSyncContainer.tsx` as a live `'use client'` polling leaf (M-2). This is documentation, not code — outside the auditor's remediation scope — but it is now stale. The orchestrator should dispatch `spec` to reconcile the SPEC with the removal (and note that the FSD §13 / M-2 "multi-device sync within ~2s" intent is no longer implemented, if that intent still stands).
- `app/_components/BoardView/BoardView.tsx:117` — the removed JSX mount left a blank line between `<BoardTabsContainer />` and the closing `</div>`. Cosmetic only; the formatter normally clears it. Note-level.

<!-- /AUTO:CARD -->

## Intent

The client runs an 8-jet-ski rental booth on the Croatian coast. Business is sharply peaked: in summer demand arrives in **sudden bursts** of walk-ups, each party wanting a different quantity, start time, and duration. Staff today track all of this on paper or from memory, which breaks exactly at peak — rentals overlap, skis come back late, and delay cascades onto everyone behind them. The single question the operator must answer over and over, under pressure, with wet hands in bright sun, is: **"Can I rent N skis at time T for D minutes?"**

The Booth Board makes that answer **obvious and instant**. It shows the whole day's bookings, computes availability live from the current bookings, surfaces late returns and at-risk downstream rentals impossible to miss, and lets the operator create, send out, return, extend, edit, or cancel a booking in a few taps. Multiple devices share one Board with a current picture. The client never administers anything — they open a link and use it. The Board is favour-grade, deliberately minimal so it can be built in roughly one day.

## Scope

**In** — drawn verbatim from FSD §9, §10, §12, §13.

Functional (FSD §9):
- FR-1 — present all of today's bookings as a single, readable list (quantity, time, duration, renter name, notes, status).
- FR-2 — list intelligently grouped and ordered: **out** first (soonest due first; **late ones red and pinned to the top**), then **upcoming** in time order.
- FR-3 — returned and cancelled bookings drop out of the main view but remain viewable via a history toggle.
- FR-4 — create a booking by choosing quantity, start time, and duration, optionally adding a renter name and notes.
- FR-5 — while creating/editing, show a **live verdict**: "fits, N skis free" or "doesn't fit, next N free at HH:MM".
- FR-6 — a booking's start time shall not be set earlier than the present (except "Now").
- FR-7 — when a request does not fit, operator may **book anyway**; the Board reflects the resulting over-commitment honestly.
- FR-8 — hand out skis in one action ("Send out"), recording hand-out time and starting due-back countdown.
- FR-9 — record returns, all at once or as a partial count; returned skis free capacity immediately.
- FR-10 — extend an active rental quickly (+15 / +30) or edit its duration directly.
- FR-11 — edit any field of any non-terminal booking; cancel any booking.
- FR-12 — always show how many skis are free **now**; when none are free, show the next time and quantity that becomes available today.
- FR-13 — availability is derived live from the current bookings, never entered or maintained by hand.
- FR-14 — a booking past its due time by more than the late grace is flagged **late** and pinned to the top.
- FR-15 — a late or extended rental holds its skis until its return is recorded.
- FR-16 — any upcoming booking that no longer fits because of lateness or an extension is flagged **at risk**.
- FR-17 — a booked rental whose start has passed beyond the no-show grace, undispatched, is flagged **possible no-show** with a one-tap cancel; never auto-cancelled.
- FR-18 — present only today's rentals; at the start of a new local day, present a clean day (prior day's completed bookings retained for the optional report).

Business rules (FSD §10):
- R-AVAIL-1 — fleet capacity 8 may never be exceeded across active rentals.
- R-AVAIL-2 — fit: peak commitment by others during the proposed window, plus Q, must not exceed 8.
- R-AVAIL-3 — boundary handoff: a window ending at T does not conflict with one starting at T.
- R-AVAIL-4 — next opening: earliest start at/after the requested start, within today, at which the requested quantity fits for the requested duration.
- R-AVAIL-5 — turnaround buffer (default 0); a returned ski stays unavailable for that buffer after its rental ends.
- R-AVAIL-6 — override: operator may force a non-fitting rental; over-commitment shown honestly, never hidden.
- R-LATE-1 — out and past due by more than late grace → **late**.
- R-LATE-2 — a late rental's skis remain committed until return is recorded; its window stretches to the present.
- R-LATE-3 — any upcoming rental rendered un-fittable by lateness or extension is **at risk**.
- R-NOSHOW-1 — a possible no-show is only ever flagged, never auto-cancelled.

Usability (FSD §12):
- U-1 — single working surface (one primary screen + one create/edit panel; no deep navigation).
- U-2 — predefined-first: quantity 1–8 increments, start as **Now** or quick time presets, duration **30 / 45 / 60**, row actions **Send out / Return / Extend / Edit / Cancel**.
- U-3 — escape hatches: custom start time, custom duration, free-text name and notes, **book-anyway** override.
- U-4 — effort ceilings: create ≤ 4 taps; send out 1 tap; return all 1 tap; return partial ≤ 2 taps; extend 1 tap; cancel ≤ 2 taps.
- U-5 — glanceability: free-now, what's out and due, and anything late or at-risk readable above the phone fold.
- U-6 — field-ready: large, high-contrast, sunlight-legible; comfortable touch targets; one-handed; obvious cold (no onboarding).
- U-7 — safe actions: destructive actions confirm or are undoable.

Multi-device (FSD §13):
- M-1 — shared Board; no per-device or per-person separate states.
- M-2 — changes appear on every other operator's device within a few seconds.
- M-3 — concurrent edits: latest change wins; all devices converge.
- M-4 — availability is recomputed against the shared, current set of bookings, so every device gives the same fit answer.
- M-5 — shared clock: "now", due times, and lateness judged consistently.
- M-6 — brief connectivity loss does not lose an operator's action; on reconnection the Board returns to consistent shared picture.

**Out** — never build.

From FSD §15 (verbatim):
- Multi-day calendar, future dates, recurrence.
- Pricing, payments, deposits, invoices.
- Customer accounts or customer-facing booking.
- Notifications of any kind (SMS / email / push).
- Assigning specific machines to *future* bookings.
- Automatic rescheduling of the queue.
- Maintenance, fuel, staff, or multi-location management.
- Any client-facing administration or settings screen.
- "Anything not explicitly required in §9 or listed in §17 is out of scope."

From FSD §17 — future enhancements, **deferred** (not in this change-unit):
- Machine labels (naming the 8 skis and optionally tagging which physical machines went out).
- Daily report (end-of-day summary of completed bookings).
- Day timeline (visual of free-count across the day).

Additionally, **not in this change-unit** (implementation calls):
- No authentication, no Principal, no tenant, no policy. The Nucleus `@core/auth`, `@core/identity`, `@core/iam` packages remain installed but are not used.
- No realtime transport (WebSocket / SSE / Pusher). **No polling either — removed 2026-07-03 at the operator's request (see Decision #4, superseded).** The Board updates only via mutation-driven revalidation (`revalidatePath` / `revalidateTag` in `app/actions.ts`) plus `force-dynamic` rendering. A device reflects its own mutations and manual reloads; there is no cross-device auto-sync. **This means FSD §13 M-2 ("changes appear on every other operator's device within a few seconds") is UNMET by design** — a deliberate trade-off, not an oversight (see the open note under Decisions).

## Decisions

1. **No authentication, no Principal, no tenant.** FSD §6 locks "no client administration" and the operator "opens a link on a phone and uses it." A single shared Board with no login is the entire access model. The Nucleus `@core/auth`/`identity`/`iam` packages remain installed for completeness but are not imported. **Why:** auth would violate FSD §6 (zero setup) and U-6 (obvious cold).

2. **better-sqlite3 at `data/board.db` (gitignored).** Rejected: Postgres (overkill for a single-instance favor app; needs a separate process), Neon (introduces cloud config the client doesn't have), in-memory only (loses state on restart). **Why:** zero-config, no separate server, perfect for a one-day favor with a tiny schema and a single host. Drizzle ORM sits on top so the repository pattern stays the same shape as the rest of Nucleus.

3. **Capacity model, no machine identity.** FSD §6 locks "Capacity, not assignment." Bookings hold an integer `quantity` (1–8); no booking ever references a specific machine. Future enhancement §17.1 (machine labels) is explicitly out of scope. **Why:** matches the FSD's locked rental model and keeps R-AVAIL-2 (peak-commitment fit) trivial to compute.

4. ~~**Polling sync via `router.refresh()` every ~2s.**~~ **SUPERSEDED / REVERSED 2026-07-03 at the operator's request ("no polling").** Original decision (kept as fossil): Rejected WebSockets (operational overhead for a favor app), SSE (still a long-lived connection per device), Pusher/Ably (third-party config the client must not need); server actions revalidate the page with `revalidatePath('/')` and a tiny `'use client'` leaf (`_containers/BoardSyncContainer/BoardSyncContainer.tsx`) polled `router.refresh()` on a 2-second interval; rationale was that this satisfied FSD §13 M-2 ("within a few seconds") with the minimum mechanism, and M-3 (latest-write-wins) fell out of standard server-action ordering against a single SQLite writer. **What changed:** the operator explicitly asked to remove polling. `BoardSyncContainer` and its directory were deleted; `BoardView.tsx` no longer imports or mounts it. The Board now updates **only** via mutation-driven revalidation (`revalidatePath` / `revalidateTag` in `app/actions.ts`) over a `force-dynamic` page — a device reflects its own mutations and manual reloads, but there is no cross-device auto-sync. This deliberately reverses the M-2 sync intent this decision established (referenced elsewhere as SPEC Decision #4 / FSD §13 M-2 / DEC-TF3). See the open note below.

5. **Module layout: `modules/bookings/` (business) + `app/` (UI).** Follows `project-structure.md` §1–§2: business domain modules live under `modules/`, never `packages/`. The booth board is application-specific, not a propagated core capability. **Why:** keeps the DDD layer cake (`domain/` / `application/` / `infrastructure/` / `schema/`) inside one business module, and lets `app/page.tsx` stay a thin server-side composition.

6. **Europe/Zagreb as the local-day boundary.** FSD §7 fixes this. `FR-18` (clean day at start of new local day) and `R-LATE-1` (lateness past due time) are computed against `Europe/Zagreb` regardless of server or device locale. **Why:** the Board is a single physical booth in Croatia; one zone is the only zone that matters.

<!-- 2026-06-08 — operator review round (six-item change-unit). Decisions DEC-A..DEC-D record the architectural calls that govern AC-1..AC-6 below. -->

7. **DEC-A — Availability algorithm is sacred.** `modules/bookings/domain/availability.ts` is the single source of truth for every fit check in the system. Every flow that asks "does this fit?" — create, edit, send-out validation, future flows — routes through `computeAvailabilityUseCase` (or calls `fits()` / `nextOpening()` / `peakCommitment()` directly from the domain layer). The functions stay pure, deterministic, and side-effect-free; the purity contract is non-negotiable. No duplication of fit logic is permitted in server actions, containers, components, or other use cases. **Why:** the algorithm is the operator's trust anchor — every device gives the same answer because every device runs the same pure code (FSD §13 M-4). Duplicating the rule in a UI guard or a server-action precheck creates the inevitable drift bug where the verdict says one thing and the create path enforces another. Tagged against `architecture.md §3` (pure core / imperative shell).

8. **DEC-B — Brute-force reservation removed.** The `Rezerviraj svejedno` (book-anyway) override is deleted from the system. The `bookAnyway` flag is removed from `createBookingUseCase`'s input, from `createBookingAction`, and from the UI. `createBookingUseCase` ALWAYS enforces `fits()`. If a race condition causes a not-fit at submit time (another operator on a second device commits between verdict check and submit), the use case returns a domain error (`CAPACITY_EXCEEDED` or equivalent, donnie picks the code) and the UI surfaces it as an error banner. The board never books over capacity, ever. **Why:** the original brute-force path (FSD §10 R-AVAIL-6, FSD §12 U-3) was a hedge — "trust the operator over the board." Operator usage has shown the opposite: the board is correct, the override is a footgun. Removing it eliminates a class of bug where the board displays honest over-commitment that the operator did not in fact intend. This is a deliberate narrowing of FSD §10 R-AVAIL-6 and FSD §12 U-3 — the change-unit is the operator's call, recorded here. The honest-over-commitment surface (peak commitment shown when late returns push out an upcoming window — R-LATE-3 at-risk) is preserved and is not the same as the deleted manual override.

9. **DEC-C — Početak presets are absolute clock times anchored to the quarter-hour.** The current preset row (`Sada / +15 / +30 / +1h` — relative offsets) is replaced with absolute clock-time presets aligned to the next quarter-hour boundary on the hour. Given `now = 09:49`, presets render as `[10:00] [10:15] [10:30] [10:45]` plus a `[više…]` chip that expands inline to the next ~8 boundaries (`11:00, 11:15, …, 12:45`). A manual `HH:MM` input is always visible below, more prominent than today's collapsed state. "Sada" is no longer a preset — the operator picks an explicit clock time. **Why:** operators think in clock time when staring at a watch and a crowd, not in relative offsets. The mental load of "is +30 from 09:49 the 10:19 I want, or the 10:15 I should round to?" is the bug we are removing. A pure helper `nextQuarterHourBoundaries(now, count): Date[]` lives in `modules/bookings/domain/` so future flows can reuse the same time math (no `Date.now()` inside the helper — `now` passed in, per `architecture.md §3`).

10. **DEC-D — `nextOpeningQuantity` removed from the availability verdict.** The `AvailabilityVerdict` type no longer carries `nextOpeningQuantity` (the total free count at the future time). The verdict on the doesn't-fit branch shrinks to `{ fits: false, nextOpeningAt }`. The verdict label always frames the answer in terms of the operator's selected quantity — never an unrelated capacity number. Labels: `Stane — {freeNow} slobodnih` (fits); `Slobodno za {quantity} skutera u {HH:MM}` (doesn't fit, has next slot today); `Nema slobodnih termina danas` (doesn't fit, no slot today). **Why:** the current label "Ne stane — idućih 4 slobodnih u 16:42" answers a question nobody asked. The operator selected Q=2 and wants to know "when can I rent 2?" — the existing `nextOpening(Q, ...)` domain function already correctly finds that time. Exposing `FLEET_SIZE - commitmentAt(nextOpeningAt)` was a useless extra field that crowded the label and seeded confusion. Tagged against `architecture.md §10` (code is communication — names and shapes are the message).

<!-- 2026-06-09 — recorded after the cleanup pass that landed `lib/time.ts`. DEC-E formalizes the directory choice and acknowledges the deviation from DEC-C's original "modules/bookings/domain/" prescription. -->

11. **DEC-E — Project-shared UI-time utilities live at `lib/time.ts` (project root), not in a module's domain layer.** Pure time/calendar math helpers used by UI containers (`nextQuarterHourBoundaries`, `formatHHMM`, `parseHHMM`, `resolveStartMs`, `resolveDurationMin`) live at `lib/time.ts`. They are not bookings-domain semantics; they are project-shared utilities consumed by `app/_containers/`. **Why:** the architecture-guard hook + `project-structure.md §4` restrict `app/` imports from a module to a narrow surface (`domain/types`, `application/{verb}{Entity}UseCase`, `infrastructure/session`, `packages/@core/*`). A pure helper placed in `modules/bookings/domain/timePresets.ts` could not be imported by `app/_containers/` without breaking that contract. The `packages/shared/` location would have been ideal in principle but is hook-blocked under the `packages/`-wide nucleus-guard (writes to `packages/` are blocked outside the manifest). The project-root `lib/` directory is the established pattern alongside the pre-existing `lib/observability.ts` Turbopack shim — utilities used across the whole project, outside nucleus's jurisdiction. Tagged against `project-structure.md §1` (acknowledged top-level dir extension) and `architecture.md §3` (pure core / imperative shell — helpers are pure; UI calls them). **Supersedes the helper-placement clause of DEC-C** ("Place in a small co-located file (e.g. `modules/bookings/domain/time.ts`)") — the underlying purity contract and the AC-4.2 acceptance criterion remain unchanged. **Open question for the next Nucleus cycle:** whether `packages/shared/lib/` should be carved out as a writable, hook-allowed surface for project-shared utilities. Until then, `lib/` at project root is canonical for this project.

<!-- 2026-06-09 — operator-reported bug in the live availability verdict label. DEC-F records the fix. -->

12. **DEC-F — Availability verdict's "free count" is computed at the requested slot, not at "now".** The `fits: true` arm of `AvailabilityVerdict` exposes `freeAtSlot: number` (renamed from `freeNow`), computed as `FLEET_SIZE - peakCommitment(allBookings, startTime, endTime, now)` — the peak commitment by other bookings across the requested window. The label "Stane — N slobodnih" now reports how many scooters are free **during the requested slot**, matching what the fit check actually evaluates. **Why:** the prior implementation returned `computeFreeNow(allBookings, now)` — scooters free at the present moment — which is a different question than "does this fit?". When 3 'booked' reservations start in the future, they don't contribute to `commitmentAt(now)`, so the label reported too many free scooters relative to the requested window. The fit check itself was always correct (it has always used `peakCommitment` over the requested window); only the displayed count was inconsistent with the verdict's true semantics. The fix aligns the displayed count with the question the verdict answers. **Scope is narrow:** the `BoardSnapshot.freeNow` field on the board header is untouched — that field correctly means "free right now" and is rendered above the form. Only the form/edit verdict semantics + the field name change. Tagged against `architecture.md §10` (code is communication — names must mean what they say) and `architecture.md §14` (debuggability — the field name and the math now agree, eliminating a class of "the label lies" confusion).

<!-- 2026-07-03 — polling removal. Open note below records the M-2 trade-off so no future reader mistakes it for an oversight. -->

> **OPEN NOTE (2026-07-03) — M-2 multi-device sync is UNMET by design.** The original FSD §13 M-2 requirement — "keep every operator's device in sync within ~2s" — is **no longer implemented**. Decision #4 (2s `router.refresh()` polling via `BoardSyncContainer`) established it; that decision was reversed on 2026-07-03 at the operator's explicit request ("no polling"). Current behavior: the Board updates only via mutation-driven revalidation (`revalidatePath` / `revalidateTag`) over a `force-dynamic` page, so a device reflects **its own** mutations and manual reloads — a second operator's device does **not** auto-refresh until it is manually reloaded or performs its own mutation. This is a **deliberate trade-off**, not a bug. If cross-device sync is ever required again, it must be re-added through a new decision (polling was the prior mechanism; SSE / WebSocket / Pusher were the rejected alternatives in the original Decision #4). AC (the first FSD §16 checkbox — "All operators' devices reflect any change to the Board within a few seconds") is correspondingly NOT satisfied by the current build; see the annotation on that criterion below.

## Acceptance Criteria

<!-- Verbatim from FSD §16. These are documentation of intent; the auditor does not run them. -->

- [ ] All operators' devices reflect any change to the Board within a few seconds. **← UNMET BY DESIGN as of 2026-07-03 (polling removed at operator request; see Decision #4 superseded + the open note above). A device reflects only its own mutations + manual reloads; there is no cross-device auto-sync.**
- [ ] Given 4 skis 12:00–13:00 and 2 skis 12:30–13:15, a request for 3 skis 12:45–13:30 is reported as not fitting, with next opening 13:00 (worked example A).
- [ ] A rental ending exactly at a time T does not block a rental starting at T (worked example B).
- [ ] A rental due 12:45, still out at 12:51, shows as late and pinned; an upcoming rental depending on it shows at-risk.
- [ ] A full booth shows the correct next-available time and quantity.
- [ ] Returning 2 of 4 skis frees 2 immediately and leaves the booking out with 2 remaining.
- [ ] A booking is created in ≤ 4 taps; send out 1 tap; return all 1 tap; cancel ≤ 2 taps.
- [ ] A possible no-show is flagged after grace and is never auto-cancelled.
- [ ] At the start of a new local day the Board shows a clean day.
- [ ] The Board is legible and fully operable one-handed in bright sun with no instructions.
- [ ] A brief connectivity drop loses no action and the Board returns to a consistent shared picture.

<!-- 2026-06-08 — operator review round (six-item change-unit). AC-1..AC-6 capture the new acceptance criteria; the FSD §16 list above is the original contract and stays as-is. Croatian button names are verbatim. -->

### VANI section (Out rentals)

- [ ] **AC-1.1** — The `+15` and `+30` quick-extension buttons are removed from `BookingRow` when rendered in the VANI/Out section. The underlying `extendBookingUseCase` stays intact (still reachable via the **Uredi** edit flow); only the row-level quick buttons go away.
- [ ] **AC-1.2** — Every destructive row action — **Vrati sve**, **Vrati X**, **Otkaži** — opens a confirmation modal before firing the corresponding server action. Each modal reuses the existing `ConfirmButtonView` component and shows: operation name, target booking (renter + qty + time), and explicit Croatian confirm/cancel buttons.

### Najavljeno section (Upcoming)

- [ ] **AC-2.1** — When a booking's `startTime < now`, the **Pošalji vani** button on that row is disabled — both visually (muted style) and functionally (`disabled` attribute, no `onClick` fallback). ~~The board's ~2s polling will pick up the transition naturally.~~ **(2026-07-03: polling removed — the `startTime < now` transition is now reflected on the next `force-dynamic` render, i.e. on the operator's own next mutation or a manual reload, not automatically.)**
- [ ] **AC-2.2** — Tapping **Uredi** on an upcoming booking expands an inline edit panel directly under the row showing the same fields as Nova rezervacija (quantity 1–8 segmented control, Početak picker per AC-4, Trajanje pills + custom). The live availability verdict re-runs through the SAME `computeAvailability` server action / use case the create flow uses — no duplicated fit logic anywhere. When the proposed edit doesn't fit, the **Spremi promjene** button is visually and functionally disabled (same rule as AC-6.1). The Cancel button collapses the panel without saving.

### Availability verdict label

- [ ] **AC-3.1** — `nextOpeningQuantity` is removed from `AvailabilityVerdict` in `modules/bookings/domain/types.ts`. The corresponding computation (around `computeAvailabilityUseCase.ts:126-129`) is removed. The verdict on the doesn't-fit branch is exactly `{ fits: false, nextOpeningAt }`.
- [ ] **AC-3.2** — The `VerdictLine` in `BookingFormPanel.tsx` accepts the form's current selected quantity as a prop and renders:
  - fits → `Stane — {freeNow} slobodnih`
  - doesn't fit, has next slot today → `Slobodno za {quantity} skutera u {HH:MM}`
  - doesn't fit, no slot today → `Nema slobodnih termina danas`

### Početak picker

- [ ] **AC-4.1** — The Početak preset row shows absolute clock times anchored to the next quarter-hour boundary on the hour. Given `now = 09:49`, the row renders `[10:00] [10:15] [10:30] [10:45]` plus a `[više…]` chip. Tapping `[više…]` reveals the next ~8 increments inline (`11:00, 11:15, …, 12:45`). A manual `HH:MM` input is always visible below the preset row, more prominent than today's hidden state. "Sada" is no longer a preset.
- [ ] **AC-4.2** — Boundary computation lives in a pure helper `nextQuarterHourBoundaries(now: Date, count: number): Date[]` in `modules/bookings/domain/` — `now` is passed in (no `Date.now()` inside), no side effects, deterministic.

### Brute-force override

- [ ] **AC-5.1** — The **Rezerviraj svejedno** warning button is removed entirely from `BookingFormPanel.tsx`. No brute-force reservation UI affordance remains.
- [ ] **AC-5.2** — The `bookAnyway` parameter is removed from `createBookingUseCase`'s input type, from the use case's internal fit-check (it now ALWAYS enforces fits), from `createBookingAction` in `app/actions.ts`, and from every container/component prop. The `onSubmitBookAnyway` handler and the `showBookAnyway` prop are deleted.
- [ ] **AC-5.3** — If a race condition causes a not-fit at submit time (e.g. another operator on a second device commits between verdict check and submit), `createBookingUseCase` returns a domain error (donnie picks the code — e.g. `CAPACITY_EXCEEDED`) which surfaces in the UI as an error banner. No silent override path exists.

### Submit CTA gating

- [ ] **AC-6.1** — The primary **Rezerviraj** button in `BookingFormPanel.tsx` is disabled (visual + functional) whenever `verdict !== null && verdict.fits === false`. While the verdict is loading (`isComputingVerdict`), the button is also disabled. The disabled state uses the `disabled` attribute plus a muted-style class set — no `onClick` fallback.
- [ ] **AC-6.2** — The same gating rule applies to the new edit-panel **Spremi promjene** button introduced in AC-2.2.

## Tasks

- [ ] **T1 — Schema** (owner: archie)
  Create the `bookings` table in `modules/bookings/schema/` (Drizzle, SQLite dialect):
  - `id text primary key` (uuid or nanoid)
  - `quantity integer not null` — CHECK `quantity between 1 and 8`
  - `start_time integer not null` — unix-ms
  - `end_time integer not null` — unix-ms; CHECK `end_time > start_time`
  - `duration_min integer not null`
  - `renter_name text` (nullable)
  - `notes text` (nullable)
  - `status text not null` — enum-constrained to `'booked' | 'out' | 'returned' | 'cancelled'` (CHECK)
  - `returned_count integer not null default 0` — CHECK `returned_count between 0 and quantity`
  - `dispatched_at integer` (nullable) — unix-ms, set when status moves to `out`
  - `created_at integer not null`
  - `updated_at integer not null`
  - Indexes appropriate for "today's bookings" reads (status + start_time).
  Produce a Minimal Change Report for user approval before any migration is run.

- [ ] **T2 — Business module** (owner: donnie)
  Build `modules/bookings/` along the DDD layer cake.
  - `domain/types.ts` — `Booking`, `BookingStatus`, `CreateBookingInput`, `AvailabilityVerdict`, etc.
  - `domain/availability.ts` — pure functions for the FSD §10 rules: `computeCommitmentAt(bookings, t)`, `fits(bookings, q, start, end)` (R-AVAIL-2 + R-AVAIL-3 boundary handoff), `nextOpening(bookings, q, durationMin, fromTime, endOfDay)` (R-AVAIL-4), `freeNow(bookings, now)`, `lateBookings(bookings, now, graceMin)` (R-LATE-1 + R-LATE-2 window-stretch), `atRiskUpcoming(bookings, now)` (R-LATE-3), `possibleNoShows(bookings, now, graceMin)` (R-NOSHOW-1).
  - `application/` — use case factories, one per file:
    `makeCreateBookingUseCase`, `makeSendOutUseCase`, `makeReturnSkisUseCase` (partial + full), `makeExtendBookingUseCase`, `makeCancelBookingUseCase`, `makeEditBookingUseCase`, `makeListTodayBookingsUseCase`, `makeComputeAvailabilityUseCase`, `makeComputeNextOpeningUseCase`. Each returns `Result<T, BookingError>`.
  - `infrastructure/database.ts` — single shared `better-sqlite3` + drizzle instance, opened against `data/board.db` (auto-created).
  - `infrastructure/repositories/DrizzleBookingRepository.ts` — implements `IBookingRepository` (save, findById, findToday, findActive, update, softMarkCancelled).
  - Each use case file exports a pre-wired instance (per `project-structure.md` §4 — no barrels).

- [ ] **T3 — Server-side route layer** (owner: nexus)
  - `app/page.tsx` — server component. No auth gate. Declares `export const dynamic = 'force-dynamic'` (board reflects current time). Calls `listTodayBookings` + `computeAvailability` use cases, passes raw data to a frankie container, returns `null` until frankie replaces it.
  - `app/actions.ts` — server actions for: `createBookingAction`, `sendOutAction`, `returnSkisAction`, `extendBookingAction`, `cancelBookingAction`, `editBookingAction`. Each: parse FormData (presence validation only), call the matching use case, `revalidatePath('/')`, return mapped error code.
  - `app/loading.tsx`, `app/error.tsx`, `app/not-found.tsx` — skeleton files (return `null`); frankie will replace.

- [ ] **T4 — UI** (owner: frankie)
  Replace nulls in `page.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx` and create `app/_components/` + `app/_containers/`.
  - `_components/AvailabilityHeader.tsx` — free-now count + next-opening line (U-5 glanceability, above the fold).
  - `_components/BookingsList.tsx` — sections "Out" (soonest due first, late ones red and pinned) and "Upcoming" (time order).
  - `_components/BookingRow.tsx` — status pill, late / at-risk / no-show flags, and the row actions (Send out / Return / Extend / Edit / Cancel) wired to server actions via `<form action={}>`.
  - `_components/BookingFormPanel.tsx` — quantity stepper (1–8), start = Now or HH:MM presets, duration 30/45/60/custom, name & notes, live verdict, **Book** and **Book anyway** buttons.
  - `_components/HistoryToggle.tsx` — toggles returned/cancelled rows back into view (FR-3).
  - `_containers/BookingFormContainer.tsx` — small `'use client'` container holding form state + verdict computation request.
  - ~~`_containers/BoardSyncContainer.tsx` — small `'use client'` leaf that calls `router.refresh()` every ~2s (M-2 polling sync).~~ **REMOVED 2026-07-03 — the operator asked for no polling. This leaf and its directory were deleted; `BoardView.tsx` no longer imports or mounts it. No auto-sync leaf exists; the Board relies on mutation-driven revalidation + `force-dynamic` only. See Decision #4 (superseded).**
  - Tailwind v4 design: high-contrast, large touch targets, sunlight-legible (U-6).

- [ ] **T5 — Architectural review** (owner: auditor)
  Final pass over the full change-unit against `architecture.md`, `project-structure.md`, `ddd-architecture.md`, `react-components.md`, `server-first-react.md`, `page-architecture.md`, `server-actions.md`, plus the per-agent rule files. Verdict written to `<!-- AUTO:VERDICT -->` and findings to `<!-- AUTO:CARD -->`.

<!-- 2026-06-08 — operator review round (six-item change-unit). T6..T9 ordered so types drive the diff: domain → server → UI → audit. -->

- [ ] **T6 — Domain + use case types** (owner: donnie)
  Drive the diff from the type layer first.
  - `modules/bookings/domain/types.ts` — drop `nextOpeningQuantity` from `AvailabilityVerdict`. The doesn't-fit branch is now exactly `{ fits: false, nextOpeningAt: number }` (no extra field). (AC-3.1, DEC-D)
  - `modules/bookings/application/computeAvailabilityUseCase.ts` — remove the `nextOpeningQuantity` computation around lines 126–129. The use case still derives `nextOpeningAt` via the existing pure `nextOpening()` domain function — no fit logic moves. (DEC-A)
  - `modules/bookings/application/createBookingUseCase.ts` — remove `bookAnyway` from the input type AND from the use case body. The fit check is no longer conditional; the use case ALWAYS calls `fits()` and returns a domain error on not-fit. Pick the right error code (suggested `CAPACITY_EXCEEDED`); add to `BookingError` taxonomy in `modules/bookings/application/bookingError.ts`. (AC-5.2, AC-5.3, DEC-B)
  - Update the `createBookingUseCase.capability.ts` sidecar to reflect the input-shape change (drop the `bookAnyway` capability annotation if listed).
  - `modules/bookings/domain/` — add a new pure helper `nextQuarterHourBoundaries(now: Date, count: number): Date[]`. Returns `count` `Date` values starting at the next quarter-hour boundary at or after `now`. Pure, deterministic, `now` passed in (no `Date.now()` inside), no side effects. Place in a small co-located file (e.g. `modules/bookings/domain/time.ts`) — only abstract if a second caller emerges. (AC-4.2, DEC-C, architecture.md §3, §9)
  - Run `pnpm tsc --noEmit` to confirm the type changes cascade cleanly into the application layer before nexus picks up.

- [ ] **T7 — Server-action signatures + error mapping** (owner: nexus)
  - `app/actions.ts` — remove `bookAnyway` from `createBookingAction`: drop the `formData.get('bookAnyway')` parse, drop the parameter from the use case call, drop any related shape from the action's input contract. (AC-5.2)
  - Map any new domain error code introduced by donnie (e.g. `CAPACITY_EXCEEDED`) to a user-facing Croatian string in the action's error-mapping switch. The new error surfaces in the UI as an error banner per AC-5.3.
  - Confirm `computeAvailabilityAction` signature is unchanged on the input side — only the output shape narrows (no `nextOpeningQuantity` in the returned verdict). Existing UI callers will need a frankie sweep to drop usages (T8).
  - No changes to `extendBookingAction`, `editBookingAction`, `cancelBookingAction`, `sendOutAction`, or `returnSkisAction` signatures expected — destructive-action confirmation lives entirely in the UI shell per AC-1.2; the actions remain the same five-step adapters.

- [ ] **T8 — UI sweep** (owner: frankie)
  Replace the existing affordances per AC-1..AC-6 above. Croatian button names verbatim. **Frankie touches the UI shell only — every fit check still routes through `computeAvailabilityAction` (the server action) which calls the use case (DEC-A). Frankie never reimplements `fits()` / `nextOpening()` in the component layer.**

  AC-1 (VANI section):
  - `app/_components/BookingRow/BookingRow.tsx` — remove the `+15` and `+30` quick-extension buttons from the VANI/Out branch. The `ExtendForm` helper stays (still used via the **Uredi** flow).
  - Wrap **Vrati sve**, **Vrati X**, **Otkaži** in `ConfirmButton` / `ConfirmButtonView` so each fires only after explicit Croatian confirm. Reuse the existing `ConfirmButton` container; no new primitive.

  AC-2 (Najavljeno section):
  - In `BookingRow.tsx`, add the overdue-disabled state to **Pošalji vani**: when `startTime < now`, render with `disabled` attribute + muted style; no `onClick` fallback.
  - Build the inline edit affordance — expanding under the row on **Uredi**. Either reuse `BookingFormPanel` in an "edit" mode (preferred — same shape, one verdict line, same `computeAvailabilityAction` call path) or extract a slimmer cousin only if the conditional sprawl is worse than the duplication. Wire the panel's submit to `editAction` → `editBookingUseCase`. Live verdict comes from `computeAvailabilityAction` against the proposed edit.

  AC-3 (Verdict label):
  - `BookingFormPanel.tsx` — update `VerdictLine` to take the form's current selected `quantity` as a prop. Render the three labels per AC-3.2 (Croatian strings verbatim).

  AC-4 (Početak picker):
  - `BookingFormPanel.tsx` — replace the `Sada / +15 / +30 / +1h` preset row with absolute quarter-hour clock-time chips computed via `nextQuarterHourBoundaries(now, 4)`. Add the `[više…]` chip that expands inline to the next 8 boundaries. Surface the manual `HH:MM` input below the preset row (always visible, not collapsed).

  AC-5 (Brute-force removed):
  - `BookingFormPanel.tsx` — delete the **Rezerviraj svejedno** button, its handler, and the `showBookAnyway` prop.
  - `app/_containers/BookingFormContainer.tsx` — delete the `onSubmitBookAnyway` handler and any related state branching.
  - Confirm no remaining call sites pass `bookAnyway` to the action.

  AC-6 (Submit CTA gating):
  - `BookingFormPanel.tsx` — wire `disabled` state on the primary **Rezerviraj** button: `disabled={isComputingVerdict || (verdict !== null && verdict.fits === false)}`. Use `disabled` attribute + muted-style class set; no `onClick` fallback.
  - Apply the same gating rule to the new edit-panel **Spremi promjene** button introduced in AC-2.2.

<!-- 2026-06-09 — DEC-F bugfix change-unit. Three-file scope; types drive the diff. -->

- [ ] **T10 — DEC-F bugfix: rename `freeNow` → `freeAtSlot` on the `fits: true` verdict arm and recompute against the requested window** (owner: donnie + frankie)
  - MOD `modules/bookings/domain/types.ts` — rename `freeNow: number` → `freeAtSlot: number` on the `fits: true` arm of `AvailabilityVerdict`. Update the JSDoc to describe the field as "scooters free during the requested window" (not "right now"). The `BoardSnapshot.freeNow` field is **NOT** touched — it lives at a different call site and correctly means "free right now" on the board header. (DEC-F)
  - MOD `modules/bookings/application/computeAvailabilityUseCase.ts` — in the `fits: true` branch, replace `computeFreeNow(allBookings, now)` with `FLEET_SIZE - peakCommitment(allBookings, startTime, endTime, now)`. Rename the local variable and the returned key from `freeNow` to `freeAtSlot`. The fit check itself (which already uses `peakCommitment` over the window) is unchanged — only the displayed count moves to match. (DEC-A still holds — the domain function `peakCommitment` is called from the application shell, no math is duplicated.) (DEC-F)
  - MOD `app/_components/BookingFormFields/BookingFormFields.tsx` (line ~338) — change `{verdict.freeNow}` to `{verdict.freeAtSlot}` in the `Stane — N slobodnih` label. No other component consumes the renamed field; the edit panel uses the same `BookingFormFields` body.
  - Run `pnpm tsc --noEmit` after the rename to confirm no straggling consumer reads `verdict.freeNow` (the rename will surface any leftover reference as a type error).

- [ ] **T9 — Architectural review** (owner: auditor)
  Final pass over the six-item change-unit against `architecture.md` (especially §3 pure core / imperative shell, §10 code is communication, §16 high agency on the booking-override removal, §17 empathy), `ddd-architecture.md`, `react-components.md`, `server-first-react.md`, `page-architecture.md`, `server-actions.md`, plus `frankie-rules.md`, `nexus-rules.md`, `donnie-rules.md`. **Specific checks for this change-unit:**
  - DEC-A enforced: `grep` for any duplication of `fits` / `peakCommitment` / `nextOpening` logic outside `modules/bookings/domain/availability.ts`. Only the domain layer owns the math.
  - `bookAnyway` truly gone — zero hits across `app/`, `modules/`, types, props, capability sidecars.
  - `nextOpeningQuantity` truly gone from the type, the use case, and every consumer.
  - `nextQuarterHourBoundaries` is pure: `now` is a parameter, no `Date.now()` inside, no side effects.
  - Confirmation modals route through `ConfirmButtonView` reuse — no ad-hoc confirm primitives introduced.
  - No new `'use client'` directives unless strictly required by the edit panel's interactivity (and if required, contained to a single small container).

## Change Log

<!-- ADD / MOD / DEL prefix; appended by implementing agents as work lands. -->

### 2026-06-06 — archie
ADD modules/bookings/schema/bookings.ts
ADD modules/bookings/schema/enums.ts
ADD modules/bookings/schema/index.ts
ADD modules/bookings/infrastructure/database.ts
ADD drizzle.config.ts
MOD package.json (deps: better-sqlite3, drizzle-orm, nanoid; devDeps: @types/better-sqlite3, drizzle-kit)
MOD .gitignore (add /data/)

### 2026-06-06 — donnie
ADD modules/bookings/domain/config.ts (fleet/grace/timezone constants, toLocalDayStart, toLocalDayEnd)
ADD modules/bookings/domain/types.ts (Booking, BookingId, BookingStatus, CreateBookingInput, EditBookingInput, ReturnSkisInput, ExtendBookingInput, AvailabilityVerdict, BoardSnapshot, BookingError)
ADD modules/bookings/domain/availability.ts (effectiveWindow, commitmentAt, peakCommitment, fits, freeNow, nextOpening, isLate, atRiskUpcoming, possibleNoShow)
ADD modules/bookings/domain/repository.ts (IBookingRepository interface)
ADD modules/bookings/application/bookingError.ts (bookingErr factory)
ADD modules/bookings/application/createBookingUseCase.ts + .capability.ts
ADD modules/bookings/application/sendOutUseCase.ts + .capability.ts
ADD modules/bookings/application/returnSkisUseCase.ts + .capability.ts
ADD modules/bookings/application/extendBookingUseCase.ts + .capability.ts
ADD modules/bookings/application/cancelBookingUseCase.ts + .capability.ts
ADD modules/bookings/application/editBookingUseCase.ts + .capability.ts
ADD modules/bookings/application/listTodayUseCase.ts + .capability.ts
ADD modules/bookings/application/getBoardSnapshotUseCase.ts + .capability.ts
ADD modules/bookings/application/computeAvailabilityUseCase.ts + .capability.ts
ADD modules/bookings/infrastructure/repositories/DrizzleBookingRepository.ts

### 2026-06-06 — nexus
ADD app/page.tsx (replaces Vercel template; force-dynamic, revalidate=0, getBoardSnapshot call, return null)
ADD app/actions.ts (createBookingAction, sendOutAction, returnSkisAction, extendBookingAction, cancelBookingAction, editBookingAction, computeAvailabilityAction)
ADD app/loading.tsx (skeleton — returns null; frankie fills)
ADD app/error.tsx (error boundary — returns null; frankie fills)
ADD app/not-found.tsx (404 — returns null; frankie fills)
ADD system/context/bookings/features/booth-board/HANDOFF.yaml (frankie handoff contract)

### 2026-06-06 — infra
ADD Dockerfile (multi-stage; node:22-alpine; builds standalone Next bundle; runs as non-root; native better-sqlite3 build prerequisites in the builder, libc6-compat at runtime)
ADD .dockerignore (excludes node_modules, .next, data, .env, infra/_kit/test, etc.)
ADD infra/docker-compose.dev.yml (single service `board`; bind-mounts ./data:/app/data; healthcheck via curl; uses ${STACK_PORT_APP:-3000} so the kit's port allocator can drive port assignment)
ADD infra/.env.example (documents LOG_LEVEL, STACK_PORT_APP, BOOKINGS_DB_PATH — no secrets required per Decision #1)
ADD infra/README.md (runbook: quick start, stop, reset DB, what's intentionally not here, optional HTTPS path)
MOD next.config.ts (added `output: 'standalone'` + `serverExternalPackages: ['better-sqlite3']` to support the Docker runner stage)
MOD package.json (added docker:build / docker:up / docker:down / docker:logs scripts)
Decisions: skipped Caddy (would require host /etc/hosts + mkcert trust-store writes that violate Commandment Three); deviated from infra/_kit/templates/docker-compose.dev.yml.template (which assumes Postgres + Caddy + workspace layout) because SPEC Decision #2 locks SQLite single-service.

### 2026-06-08 — frankie
UI modernization pass — forced light theme, coastal/marine accent palette (Adriatic teal primary `oklch(0.46 0.14 195)`, slate neutrals, ring matched to primary), all user-facing strings translated to Croatian (hr-HR) with operator-friendly phrasing ("skuter / skuteri" as colloquial term for jet ski). Cleared two outstanding audit notes: migrated `[var(--token)]` arbitrary-value Tailwind usage in `BookingRow` + `AvailabilityHeader` (and siblings) to the named utilities now exposed by the `@theme` block; migrated `app/error.tsx`, `app/not-found.tsx`, `app/loading.tsx` off hardcoded hex/oklch literals in inline `style={{}}` blocks onto the same CSS variables the rest of the board uses.
MOD app/globals.css (removed dark-mode @media block; coastal/marine palette in `:root`)
MOD app/page.tsx (metadata only — Croatian title + description)
MOD app/error.tsx (CSS variables instead of hardcoded hex/oklch; Croatian copy)
MOD app/loading.tsx (CSS variables instead of hardcoded hex/oklch; Croatian copy)
MOD app/not-found.tsx (CSS variables instead of hardcoded hex/oklch; Croatian copy)
MOD app/_components/AvailabilityHeader/AvailabilityHeader.tsx (named Tailwind utilities; Croatian strings)
MOD app/_components/BookingRow/BookingRow.tsx (named Tailwind utilities; Croatian strings)
MOD app/_components/BookingsList/BookingsList.tsx (Croatian strings)
MOD app/_components/StatusPill/StatusPill.tsx (Croatian strings)
MOD app/_components/BookingFormPanel/BookingFormPanel.tsx (Croatian strings)
MOD app/_components/HistoryToggle/HistoryToggle.tsx (Croatian strings)

### 2026-06-08 — nexus
MOD app/layout.tsx (title "Ploča rezervacija — Iznajmljivanje skutera", Croatian description, `<html lang="hr">`; no structural changes — font loading and RootLayout untouched)

### 2026-06-08 — frankie (design pass · branding)
ADD app/_components/JetterLogo/JetterLogo.tsx
MOD app/globals.css (added --shadow-card, --shadow-card-md, --decor-wave, --text-brand-wordmark tokens; raised --text-board-xl 2.5→2.75rem; deepened --background to #f0f5f9 for card contrast lift)
MOD app/_components/AvailabilityHeader/AvailabilityHeader.tsx (Jetter brand lockup top-left; free-now hero in colored ring frame; tabular-nums clock; faint header wave decoration)
MOD app/_components/BookingRow/BookingRow.tsx (real card elevation via .booking-card / box-shadow; left-edge status accent stripe; lucide icons paired with every action; cancel softened to bg-muted text-destructive; tabular-nums on time/qty)
MOD app/_components/BookingsList/BookingsList.tsx (empty states with contextual lucide icons + warmer sub-line copy)
MOD app/_components/BookingFormPanel/BookingFormPanel.tsx (segmented 8-cell quantity grid; segmented duration pills; verdict pill with AlertCircle/CheckCircle icon; primary CTA with Bookmark icon; book-anyway with AlertTriangle, smaller weight)
MOD app/_components/HistoryToggle/HistoryToggle.tsx (icon-paired button — Clock/EyeOff)
MOD app/loading.tsx (full skeleton mirroring real header + card anatomy; .booking-card class)
MOD app/error.tsx (CloudOff in destructive/10 circle; RefreshCw on retry CTA; centered card layout)
MOD app/not-found.tsx (Anchor in bg-muted circle; Home icon on CTA)

### 2026-06-08 — frankie (cleanup · audit regressions)
MOD app/globals.css (@theme inline now maps --shadow-card, --shadow-card-md, --color-decor-wave so shadow-card / shadow-card-md / text-decor-wave utilities work)
MOD app/_components/BookingRow/BookingRow.tsx (consolidated 5 `as unknown as ServerAction` cast sites into a single one inside the ActionForm helper, with documenting comment block; replaced inline lucide-shaped SVGs with `lucide-react` imports: Send, CheckCircle2, Check, Plus, X)
MOD app/_components/BookingFormPanel/BookingFormPanel.tsx (replaced inline SVGs with lucide-react imports: CalendarPlus, Bookmark, AlertTriangle, CheckCircle2, AlertCircle; removed style={{ boxShadow: 'var(--shadow-card-md)' }} fallback)
MOD app/_components/BookingsList/BookingsList.tsx (replaced inline empty-state SVGs with lucide-react: Waves, Sun, Anchor)
MOD app/_components/HistoryToggle/HistoryToggle.tsx (replaced inline SVGs with lucide-react: EyeOff, Clock; removed style fallback)
MOD app/_components/AvailabilityHeader/AvailabilityHeader.tsx (removed two style={{}} fallbacks → shadow-card-md + text-decor-wave utilities; kept the bespoke header wave decoration SVG as it is custom, not a lucide icon)
MOD app/_components/JetterLogo/JetterLogo.tsx (fixed aria contradiction — Option A: `role="img" aria-label="Jetter"` on the SVG; outer span aria-label removed; wordmark span now aria-hidden to avoid double-announce)
MOD app/loading.tsx (removed style={{}} → shadow-card-md utility)
MOD app/error.tsx (replaced inline CloudOff + RefreshCw SVGs with lucide-react; removed style fallback)
MOD app/not-found.tsx (replaced inline Anchor + Home SVGs with lucide-react; removed style fallback)
MOD package.json + pnpm-lock.yaml (added lucide-react 1.17.0)

### 2026-06-09 — operator review round (six-item change-unit · landed across T6 donnie + T7 nexus + T8 frankie + T5 donnie correction + T7/T8 donnie+frankie cleanup pass)
Single change-unit covering six operator-driven refinements + dead-code cleanup + a11y/dedup polish. AC-1 through AC-6 all mechanically verified by the auditor (see CARD).

Domain / application (donnie):
- MOD modules/bookings/domain/types.ts — removed `nextOpeningQuantity` field from `AvailabilityVerdict` doesn't-fit branch (DEC-D); removed `bookAnyway` field from `CreateBookingInput` (DEC-B); added `CAPACITY_EXCEEDED` to `BookingError.code` union; removed orphan `'OVER_CAPACITY'` literal in cleanup pass.
- MOD modules/bookings/application/createBookingUseCase.ts — unconditional `fits()` enforcement; returns `CAPACITY_EXCEEDED` with Croatian message `"Rezervacija ne stane u trenutnu dostupnost"` on race; removed dead `bookAnyway` conditional + dead `nextOpening`/`commitmentAt` imports.
- MOD modules/bookings/application/computeAvailabilityUseCase.ts — removed `nextOpeningQuantity` computation + dead `commitmentAt` import; doesn't-fit return is now `{ fits: false, nextOpeningAt }`.
- DEL modules/bookings/domain/timePresets.ts — initially added under T6, then deleted in the T5 correction pass after the architecture-guard hook + `project-structure.md §4` import surface revealed the helper could not live in a module's domain layer if `app/_containers/` was to consume it. See DEC-E for the resolution.

Server action (nexus):
- MOD app/actions.ts — `createBookingAction` no longer parses or forwards `bookAnyway`; tightened return type to uniform `Promise<ActionResult<{id: string}>>`; removed special `OVER_CAPACITY` payload branch; pass-through Croatian error message via DEC-B contract.

UI — initial sweep (frankie):
- MOD app/_components/BookingRow/BookingRow.tsx — dropped `+15`/`+30` quick chips on Out rows (AC-1.1); wrapped **Vrati sve** / **Vrati X** / **Otkaži** in `ConfirmButton` modal (AC-1.2); disabled **Pošalji vani** when `startTime < now` (AC-2.1); mounts `BookingEditContainer` for upcoming rows (AC-2.2).
- MOD app/_components/BookingFormPanel/BookingFormPanel.tsx — new prop shape (`selectedStartTime`, `primaryPresets`, `expandedPresets`, `errorMessage`); removed **Rezerviraj svejedno** button + `onSubmitBookAnyway` handler (AC-5); disabled **Rezerviraj** when `verdict.fits=false` or loading (AC-6.1); delegates body to `BookingFormFields`.
- MOD app/_containers/BookingFormContainer/BookingFormContainer.tsx — single-path `handleSubmit()` (no `bookAnyway`); `now: Date` prop wiring; new state model (`selectedStartTime: Date | null`).
- ADD app/_components/BookingFormFields/BookingFormFields.tsx — shared form body (quantity, Početak picker, duration, name/notes, VerdictLine), two consumers (create + edit).
- ADD app/_components/BookingFormFields/croatian.ts — `skuterForm(q)` Croatian noun declension helper (initially lived under `BookingFormPanel/`; relocated in cleanup pass).
- ADD app/_components/BookingEditPanel/BookingEditPanel.tsx + app/_containers/BookingEditContainer/BookingEditContainer.tsx — inline edit panel for upcoming bookings; verdict routes through `computeAvailabilityAction` (DEC-A enforced); **Spremi promjene** gated by AC-6.2.
- MOD app/_components/BoardView/BoardView.tsx — passes `now={snapshot.now}` down to `BookingFormContainer`.
- MOD app/_components/ConfirmButtonView/ConfirmButtonView.tsx + app/_containers/ConfirmButton/ConfirmButton.tsx — upgraded from `window.confirm()` to a real modal (initial pass used hand-rolled focus; cleanup pass replaced with Radix Dialog primitive).

Cleanup pass (after auditor 20:30 WARN — orphan literal + helper-placement + duplicated helpers + hand-rolled focus):
- ADD lib/time.ts — project-shared time utilities: `nextQuarterHourBoundaries(now, count)`, `formatHHMM(date)`, `parseHHMM(value, now)`, `resolveStartMs(selectedTime, custStart, now)`, `resolveDurationMin(preset, custMin)`. All pure; `now` always passed in. See DEC-E for placement rationale.
- DEL inlined copies of `formatHHMM` / `parseHHMM` / `resolveStartMs` / `resolveDurationMin` from `BookingFormContainer.tsx` and `BookingEditContainer.tsx`; replaced with `lib/time.ts` imports.
- MOD app/_containers/ConfirmButton/ConfirmButton.tsx + app/_components/ConfirmButtonView/ConfirmButtonView.tsx — replaced hand-rolled focus management (`useEffect` + `setTimeout` + `document.querySelector`) with `@radix-ui/react-dialog` primitives (focus trap + restore + Escape built-in).
- ADD `@radix-ui/react-dialog@^1.1.16` to package.json dependencies.
- MOV app/_components/BookingFormPanel/croatian.ts → app/_components/BookingFormFields/croatian.ts (colocated with sole consumer; resolves the file-organization NOTE from the 20:30 audit).
- MOD modules/bookings/domain/types.ts — dropped orphan `'OVER_CAPACITY'` literal from `BookingError.code` union; only `'CAPACITY_EXCEEDED'` survives (resolves the one hard VIOLATION from the 20:30 audit).

Decisions added/superseded:
- DEC-E added: project-shared UI-time utilities live at `lib/time.ts` (project root), formalizing the relocation and acknowledging the deviation from DEC-C's original "modules/bookings/domain/" prescription.

State: `working` (Mario hasn't accepted the final card yet — auditor re-runs after this update, then Mario decides on commit).

### 2026-06-09 — DEC-F bugfix change-unit (planned · pending implementation)
Bug: the live availability label "Stane — N slobodnih" in the booking form was reporting `verdict.freeNow`, computed as `FLEET_SIZE - commitmentAt(allBookings, now, now)` — scooters free **right now**. When the operator had future 'booked' reservations, those didn't contribute to `commitmentAt(now)`, so the displayed count exceeded the count of scooters actually free during the requested window. The fit check itself was always correct (it has always used `peakCommitment` over the window); only the displayed count was inconsistent.

Fix scope (three files; see T10):
- MOD modules/bookings/domain/types.ts — rename `freeNow: number` → `freeAtSlot: number` on the `fits: true` arm of `AvailabilityVerdict`. `BoardSnapshot.freeNow` untouched.
- MOD modules/bookings/application/computeAvailabilityUseCase.ts — in the `fits: true` branch, swap `computeFreeNow(allBookings, now)` for `FLEET_SIZE - peakCommitment(allBookings, startTime, endTime, now)`. Rename local + returned key to `freeAtSlot`.
- MOD app/_components/BookingFormFields/BookingFormFields.tsx (line ~338) — `{verdict.freeNow}` → `{verdict.freeAtSlot}`.

Decision: DEC-F added — the verdict's "free count" is computed at the requested slot, not at "now"; the field is renamed so the name matches the math.

DEC-A still holds: the math (`peakCommitment`) lives in `modules/bookings/domain/availability.ts`; the application shell calls it; no duplication.

### 2026-07-03 — fleet size 8 → 6 (reconciliation note)

The operating fleet has been reduced from **8 scooters to 6**. `FLEET_SIZE` is now `6` in `modules/bookings/domain/config.ts`, and the `bookings` table `quantity` CHECK is tightened to `1..6` (generated migration, not yet applied). The **decision of record lives in the sibling reservation-pivot SPEC as DEC-P10** (`system/context/bookings/features/reservation-pivot/SPEC.md`), which is the active change-unit for the current product; booth-board is the superseded historical record of the original send-out lifecycle board.

Scope note for this file: the FSD-verbatim numbers preserved above — R-AVAIL-1/R-AVAIL-2 ("capacity 8"), U-2 ("quantity 1–8 increments"), Decision #3 ("integer `quantity` (1–8)"), the Intent's "8-jet-ski rental booth", and the §17 "8 skis" future-enhancement note — are quotations of the original FSD (§9/§10/§12) and past-tense change-log/verdict entries. They are left **as-is** as the original contract and historical fossil; they are not the current fleet-size claim. The current fleet size is 6 (DEC-P10). No code or FSD quote is rewritten here — this is a pointer so no reader mistakes the archived 8-scooter numbers for the live configuration.

### 2026-07-03 — remove 2s board polling (operator request: "no polling")

The 2-second board polling mechanism was removed entirely at the operator's explicit request. This reverses Decision #4 (kept as a superseded fossil) and leaves FSD §13 M-2 ("~2s multi-device sync") **UNMET by design** — recorded as the open note above the Acceptance Criteria and annotated on the first FSD §16 criterion.

- DEL app/_containers/BoardSyncContainer/BoardSyncContainer.tsx (the project's only `useEffect`-based `'use client'` leaf; ran `setInterval(() => router.refresh(), 2000)`) + its now-empty directory.
- MOD app/_components/BoardView/BoardView.tsx — removed the `BoardSyncContainer` import, the `<BoardSyncContainer />` mount, and the descriptive comments referencing the polling leaf.
- MOD app/_containers/ShowPastContainer/ShowPastContainer.tsx — rewrote the stale "board polls every 2s" comment to describe the mutation-driven revalidation model actually in force (comment-only edit).
- app/page.tsx untouched (`force-dynamic` + `revalidate = 0`).

Current behavior of record: the Board updates only via mutation-driven revalidation (`revalidatePath` / `revalidateTag` in `app/actions.ts`) over the `force-dynamic` page. A device reflects its own mutations and manual reloads; there is no cross-device auto-sync. (Auditor verdict for this change-unit: PASS with notes — see the AUTO:CARD / AUTO:VERDICT blocks; the SPEC-drift note it raised is what this entry reconciles.)

SPEC docs reconciled in this pass: Decision #4 marked superseded; Scope "not in this change-unit" polling line corrected; AC-2.1 polling clause struck; Task T4 `BoardSyncContainer` bullet struck; first FSD §16 AC annotated UNMET-by-design; open note added above Acceptance Criteria.

<!-- AUTO:WORKLOG — appended (never overwritten) by the auditor on every run -->
## Worklog

2026-06-05T23:09:45Z  auditor  engineering review  WARN  domain math + layer boundaries clean; 5 concerns (lib/ top-level, type-escape-hatch in BookingRow, orphan re-export, dead `showEdit` prop, unbounded findAll), 10 notes mostly clustered on hook-blocked globals.css forcing hardcoded colors into JSX
2026-06-06T01:30:00Z  auditor  engineering review (re-audit)  PASS with notes  3 of 4 prior findings cleared — design tokens moved to `app/globals.css` @theme block, `any` slop + orphan export + dead prop removed from BookingRow, application layer migrated from unbounded `findAll()` to bounded `findToday(start, end)`. Remaining concern: `findAll()` still exists on `IBookingRepository` (no callers in application/ today, but surface still trips §2). Remaining notes: BookingRow + AvailabilityHeader still use `[var(--token)]` arbitrary syntax instead of named utilities now that tokens are in `@theme`; framework segments (error/not-found/loading) carry hardcoded hex literals from before the unblock; `lib/observability.ts` remains as the Turbopack workaround
2026-06-08T14:00:00Z  auditor  engineering review (UI/i18n pass)  WARN  prior carryover notes cleared (arbitrary-value `[var(--token)]` migrated to named utilities across all `_components/`; framework segments error/loading/not-found migrated off hardcoded hex/oklch onto `bg-card`/`text-foreground`/`text-destructive` etc.); coastal/marine palette + `lang="hr"` shipped cleanly. NEW concern: `app/page.tsx` static `metadata` block still says "Booth Board — Iznajmljivanje jet skija" (English head, `jet skija` terminology) while the new `app/layout.tsx` metadata uses "Ploča rezervacija — Iznajmljivanje skutera" (Croatian, `skutera`). Page metadata wins on `/`; the i18n pass missed the title users actually see in the browser tab.
2026-06-08T15:30:00Z  auditor  engineering review (metadata-shadow follow-up)  PASS  both prior WARN concerns cleared — `app/page.tsx` page-level `metadata` export and `Metadata` type import deleted; `app/layout.tsx` Croatian metadata is now sole source of truth for `/`. No regressions on previously cleared notes (palette, framework segments, `[var(--token)]` migration). Six-line deletion; no other change-unit work remained.
2026-06-08T17:00:00Z  auditor  engineering review (design pass · branding)  WARN  branding + card-elevation + segmented controls + icon-paired actions landed across 10 files. Six concerns: (1) new tokens `--shadow-card-md` / `--decor-wave` declared in `:root` but NOT mapped in `@theme`, forcing `style={{}}` inline workarounds across seven files — regression of the previously-cleared 2026-06-08T14:00 finding; (2) ~16 inline lucide-shaped SVGs in JSX instead of `lucide-react` imports (frankie §2.3 + architecture §10/§17); (3-5) inline ternary class strings on AvailabilityHeader, BookingRow, BookingFormPanel segmented controls (frankie §2.2 — CVA would consolidate); (6) reintroduction of `as unknown as ServerAction` type-escape-hatch in BookingRow ActionBar (architecture §5) — same shape the 2026-06-05 audit flagged and 2026-06-06 cleared. Three notes: JetterLogo single-caller extraction (architecture §9); JetterLogo `role="img"` + `aria-hidden` markup contradiction (frankie §5); hand-rolled segmented controls vs Radix ToggleGroup (frankie §2.3). No violations.
2026-06-08T18:30:00Z  auditor  engineering review (cleanup · audit regressions)  PASS with notes  all six WARN concerns from 17:00 cleared in one tight pass. (1) `--shadow-card`/`--shadow-card-md`/`--color-decor-wave` now mapped in `@theme inline` (globals.css:113-118); zero `style={{}}` and zero `[var(--token)]` survive in `app/`. (2) `lucide-react@1.17.0` installed; ~16 inline lucide-shaped SVGs replaced by named component imports; only two `<svg>` instances remain in app/ — the JetterLogo brand glyph and the AvailabilityHeader bespoke wave curve, both non-lucide design assets correctly kept inline. (3) JetterLogo Option A confirmed — `role="img" aria-label="Jetter"` on the SVG, outer span unencumbered, wordmark `aria-hidden="true"`. (4) `as unknown as` count dropped from 5 sites to exactly 1, routed through the `ActionForm` helper with a documenting comment block at BookingRow.tsx:248-260. No regressions on prior cleared notes (palette, light-only, Croatian copy, page metadata, framework segments). The three deferred notes (frankie §2.2 ternary chains × 3 components, frankie §2.3 segmented controls → Radix ToggleGroup, architecture §9 JetterLogo single-caller) remain as low-severity notes flagged for awareness but explicitly out of scope this pass.
2026-06-08T20:30:00Z  auditor  engineering review (six-item operator review round · T6 donnie + T7 nexus + T8 frankie + T5 donnie correction)  WARN  six-item change-unit lands cleanly on the sacred-algorithm axis. DEC-A held: every fit / peakCommitment / nextOpening / commitmentAt / freeNow / effectiveWindow definition is in domain/availability.ts and nowhere else. DEC-B held: zero runtime `bookAnyway` references in app/ + modules/ + lib/ (five doc comments documenting the removal — acceptable). DEC-C held in spirit: `nextQuarterHourBoundaries` is pure with `now` passed in. DEC-D held: `nextOpeningQuantity` is gone from `AvailabilityVerdict`. AC-1..AC-6 all mechanically verified. 1 violation: `BookingError.code` union still carries the dead `'OVER_CAPACITY'` literal next to the new `'CAPACITY_EXCEEDED'` — exactly the §8 architecture / §6.11 donnie pattern that forbids unconsumed orphan symbols after a refactor. 3 concerns: (a) `lib/time.ts` placement deviates from DEC-C and T6 which both prescribed `modules/bookings/domain/` — the relocation rationale ("packages/-wide hook block") is real but the SPEC's actual prescribed path was never tried, and `lib/` extends the previously-flagged Turbopack-shim carryover; (b) `ConfirmButton` rolls its own modal focus management (setTimeout + querySelector) instead of Radix/shadcn Dialog — frankie-rules §5 explicit concern, missing focus trap / restoration / Escape; (c) `formatHHMM` / `parseHHMM` / `resolveStartMs` / `resolveDurationMin` duplicated across BookingFormContainer + BookingEditContainer — same shape as `nextQuarterHourBoundaries` which WAS deduplicated, so the deduplication is asymmetric. 3 notes: `croatian.ts` orphaned from its folder home, SPEC Change Log not updated for T6-T8 work, `Promise.all([single])` minor §9 micro-anticipation in page.tsx. All prior carryover state (frankie §2.2 ternaries, §2.3 segmented controls, JetterLogo single-caller, IBookingRepository.findAll, lib/observability shim) holds unchanged.
2026-06-09T13:45:00Z  auditor  engineering review (cleanup re-audit · 20:30 remediations)  PASS  every 20:30 finding closed cleanly in one tight pass. (1) HIGH VIOLATION resolved — `'OVER_CAPACITY'` literal removed from `BookingError.code` union; `grep -rn OVER_CAPACITY` across app/ + modules/ + lib/ returns zero hits; only `'CAPACITY_EXCEEDED'` survives (types.ts:170). (2) CONCERN — lib/time.ts placement resolved by DEC-E formalizing the deviation from DEC-C's `modules/bookings/domain/` prescription with full rationale (architecture-guard hook + project-structure §4 import surface + packages/ hook block all documented; supersedes DEC-C helper-placement clause). (3) CONCERN — `ConfirmButton` modal focus management migrated to `@radix-ui/react-dialog` primitive: focus trap, focus restoration, Escape (`onEscapeKeyDown`), click-outside (`onInteractOutside`), and full ARIA wiring all by Radix; `useEffect` + `setTimeout` + `document.querySelector` gone. (4) CONCERN — `formatHHMM` / `parseHHMM` / `resolveStartMs` / `resolveDurationMin` deduplicated to `lib/time.ts` alongside `nextQuarterHourBoundaries`; both containers now import from `@/lib/time`. (5) NOTE — `croatian.ts` relocated `BookingFormPanel/` → `BookingFormFields/` (sole-consumer colocation). (6) NOTE — SPEC Change Log updated with full 2026-06-09 landed-work entry. All sacred invariants (DEC-A through DEC-E) verified by grep. All prior carryover (frankie §2.2 ternaries, §2.3 segmented controls, JetterLogo single-caller, IBookingRepository.findAll, lib/observability shim, page.tsx Promise.all([single])) holds unchanged — explicitly out of scope this pass.
2026-06-09T14:30:00Z  auditor  engineering review (T10 / DEC-F bugfix · narrow rename + recomputation)  PASS  three-file targeted bugfix lands clean. `AvailabilityVerdict.freeNow` (fits:true arm) → `freeAtSlot`; computation switched from `commitmentAt(now)` to `peakCommitment(allBookings, startTime, endTime, now)` — same domain function `fits()` already uses (DEC-A intact, no math duplicated). Single UI consumer at `BookingFormFields.tsx:338` updated. `BoardSnapshot.freeNow` correctly preserved per DEC-F's narrow-scope clause (different call site, "free right now" semantic is correct there; `getBoardSnapshotUseCase` + `AvailabilityHeader` untouched). Capability sidecar correctly unchanged (input shape unchanged; only output field name + computation source moved). `tsc --noEmit` clean (orchestrator-confirmed) corroborates `grep -rn "verdict.freeNow"` zero-hit verification — the rename surfaced any straggler as a compile error, none existed. Architecture §10 (code is communication) + §14 (debuggability) satisfied: the field name now matches the math; the "label lies" class of bug is closed at root cause. All sacred invariants (DEC-A through DEC-F) verified. All prior carryover holds unchanged — explicitly out of scope this pass.
2026-07-03T00:00:00Z  auditor  engineering review (remove 2s board polling · deletion + comment cleanup)  PASS with notes  clean removal of the 2-second polling mechanism. `BoardSyncContainer.tsx` (the project's only `useEffect`-based `'use client'` leaf running `setInterval(() => router.refresh(), 2000)`) and its directory deleted; `BoardView.tsx` drops the import, the `<BoardSyncContainer />` mount, and both descriptive comments (inline + ASCII tree line); `ShowPastContainer.tsx` rewrites its stale "board polls every 2s" comment to describe the mutation-driven `revalidateTag`/`revalidatePath` refresh model actually in force (comment-only edit, verified not a call). `grep -rn BoardSyncContainer` across code: zero hits; `grep -rn "router.refresh|setInterval|polls every"` across app/: zero hits — no orphaned references, no dead timer, no stale polling comment survives in code. `BoardView` still consumed at page.tsx:33,90. `app/page.tsx` force-dynamic/revalidate=0 intentionally untouched. Architecture §8 (complete removal, no half-finished work) + §10/§17 (stale comment corrected not abandoned) satisfied; server-first §4 (client JS surface reduced). Two NOTES: (1) SPEC.md:294 still documents BoardSyncContainer as a live polling leaf — stale documentation, dispatch `spec` to reconcile (and confirm whether the FSD §13 / M-2 multi-device-sync intent still stands); (2) BoardView.tsx:117 leftover blank line where the mount was — cosmetic, formatter clears it. No violations, no concerns.

<!-- /AUTO:WORKLOG -->

<!-- AUTO:VERDICT — overwritten by the auditor on every run -->
## Verdict
**PASS with notes** · 2026-07-03T00:00:00Z

The removal of the 2-second board polling mechanism lands as a clean, complete deletion. This is exactly the shape architecture.md §8 (no half-finished work) rewards: the `'use client'` leaf, its directory, its import, its JSX mount, and every descriptive comment referencing it are gone in one change-unit — no orphaned references, no dead timer, no stale polling comment survives anywhere in code. The one adjacent comment that would have gone stale (`ShowPastContainer`'s "board polls every 2s") was corrected rather than abandoned, and the rewrite accurately describes the mutation-driven refresh model actually in force.

**What landed:**

- **`app/_containers/BoardSyncContainer/BoardSyncContainer.tsx` (deleted)** — the project's only `useEffect`-based `'use client'` leaf, which ran `setInterval(() => router.refresh(), 2000)`. File and now-empty directory removed. Deleting it strictly reduces shipped client JavaScript (server-first-react §4).
- **`app/_components/BoardView/BoardView.tsx`** — removed the `BoardSyncContainer` import, the `<BoardSyncContainer />` mount, the inline mount comment, and the ASCII component-tree line referencing the polling leaf. Remains a pure server `_components/` file (props → JSX, no hooks). Still consumed at `app/page.tsx:33,90`.
- **`app/_containers/ShowPastContainer/ShowPastContainer.tsx`** — comment-only edit. The stale claim "the board polls every 2s via router.refresh()" is replaced by an accurate description: toggle state persists across the server-driven refreshes triggered by mutations (`revalidateTag`/`revalidatePath`). DEC-TF3 rationale retained. Remains a slim `'use client'` state proxy (`useState` only, rendering delegated to `ShowPastView`).
- **`app/page.tsx`** — intentionally untouched (`force-dynamic` + `revalidate = 0`), consistent with the change-unit scope.

**Mechanical verification:**

- `grep -rn "BoardSyncContainer"` across `.ts`/`.tsx`: zero code hits. Only surviving reference is `SPEC.md:294` (documentation).
- `grep -rn "router.refresh|setInterval|POLL_INTERVAL|polls every|2s polling"` across `app/`: zero hits.
- `ShowPastContainer.tsx:13` `revalidateTag`/`revalidatePath` mention confirmed comment-only (not a call in a client component); the model it describes is real (`app/actions.ts` performs the calls; `page.tsx` is force-dynamic).

**Notes (do not block; PASS-with-notes):**

- **SPEC drift** — `SPEC.md:294` still documents `_containers/BoardSyncContainer.tsx` as a live polling leaf (M-2 multi-device sync). Documentation, outside auditor remediation scope, but now stale. Owner: dispatch `spec` to reconcile the SPEC with the removal and confirm whether the FSD §13 / M-2 "~2s multi-device sync" intent still stands now that active polling is gone.
- **Cosmetic** — `BoardView.tsx:117` has a leftover blank line where the mount was removed. Formatter clears it.

**Recommendation:** PASS with notes — the deletion is complete and correct; nothing that depended on the removed container was left dangling. Ready to commit once the SPEC-drift note is handled (dispatch `spec`). The Mario gate is the green light, not the auditor.

<!-- /AUTO:VERDICT -->
