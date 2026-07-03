---
id: bookings-edit-maintenance
slug: edit-maintenance
module: bookings
type: feature
state: working
created: 2026-07-02
updated: 2026-07-02
---

<!-- AUTO:CARD — overwritten by the auditor on every run -->
## CARD

_no audit run yet_

<!-- /AUTO:CARD -->

## Intent

On the jet Reservation Planning Board an operator can already CREATE a maintenance block (Croatian: "nedostupnost / kvar") and CANCEL one, but there is no way to EDIT an existing block. This is a real gap: maintenance reflects live physical reality, and reality changes after the block is recorded. A repair takes longer and needs extending; the window turns out to be shorter than feared and needs shrinking; scooters come back online one at a time so the blocked count should drop; or the note simply has a typo. Today the only recourse is cancel-and-recreate, which is clumsy and loses continuity.

This change adds an EDIT capability for maintenance blocks: an operator can adjust the blocked quantity, the start time, the end time, and/or the note on any maintenance block that has not yet fully ended. Because a maintenance block records honest over-commitment (a malfunction is reality, not a bookable slot), editing it deliberately does NOT run a capacity/fits check — mirroring how the block was created in the first place.

Reservations continue to be edited through the existing, separate reservation-edit path. This change-unit touches only the maintenance side.

## Scope

**In**
- A new maintenance-specific edit use case (domain predicate + application use case) covering quantity, start, end, and note.
- A new server action to invoke it across the client↔server boundary (epoch-ms dates, Croatian mapped errors).
- A new inline edit affordance and panel on each editable maintenance row of the board.
- Emitting a `maintenance.edit` audit event (before/after) via the AuditWriter port introduced by the sibling audit change-unit.

**Out**
- Reservation editing — unchanged; keeps using the existing reservation-edit path.
- Maintenance CREATE and CANCEL paths — unchanged.
- Any capacity/fits check on maintenance edit — deliberately absent (see DEC-EM1 / DEC-EM3).
- Any repository change — `IBookingRepository.update` already supports a full-row update.
- Any availability-verdict UI on the maintenance edit panel — not applicable without a fits check.
- Schema changes — none; the `bookings` table already holds maintenance blocks.

## Decisions

- **DEC-EM1 — A separate `editMaintenanceUseCase`, not an extension of `editBookingUseCase`.** Maintenance edit semantics differ materially from reservation edit: the editable fields are quantity / start / end / notes (NOT durationMin, NOT renterName), and critically there is NO fits() check (consistent with the create path and DEC-P3 — maintenance is honest over-commitment). DDD mandates one use case per file. _Rejected:_ adding a `kind` branch inside `editBookingUseCase` — it would fork that use case's fits()/duration/renter logic on `kind`, muddying a clean reservation use case and violating single-responsibility. _Why:_ distinct semantics deserve a distinct, testable use case.
- **DEC-EM2 — Editability window via a pure domain predicate `canEditMaintenance(booking, now)`.** Mirrors the existing `canCancel` predicate (policy lives in pure functions, donnie-rules §6.1). Rule: a maintenance block is editable while it has not fully ended (`end > now`) and is not cancelled — matching maintenance's cancellation rule, so create / edit / cancel stay consistent. Editing a still-running block is legitimate (reduce the count as scooters return, extend the repair). _Rejected:_ future-only editability like reservations — a repair in progress is exactly the moment you adjust it. _Why:_ maintenance reflects live physical reality, not a pre-booked slot.
- **DEC-EM3 — Input shape `EditMaintenanceInput { id; quantity?; startTime?; endTime?; notes? }` with merge-then-validate.** Only provided fields change; `endTime` must remain after `startTime`; quantity stays within 1..FLEET_SIZE; NO fits() check; `durationMin` is recomputed from `(endTime - startTime)` exactly as the create path does. _Rejected:_ reusing `EditBookingInput` — its fields (durationMin, renterName) are the wrong shape for maintenance. _Why:_ it should match the create path's `CreateMaintenanceInput` shape (startTime + endTime), not the reservation shape.
- **DEC-EM4 — Server action `editMaintenanceAction` follows the five-step adapter shape.** Presence-validate → single use case call → `revalidatePath('/')` → mapped Croatian error. Dates cross as epoch-ms (`startTimeMs` / `endTimeMs`) per the serialization rule. _Rejected:_ overloading the existing reservation-edit action. _Why:_ one action per use case; mirrors the existing `blockScooterAction`.
- **DEC-EM5 — UI is a maintenance-specific inline edit panel, not a reuse of the reservation edit panel.** New container ('use client' slim proxy) + pure panel: quantity 1–8 grid, Od/Do HH:MM time inputs, notes, save/cancel — opened from an edit affordance on each editable maintenance row. NO live availability verdict. _Rejected:_ reusing the reservation edit panel — it renders duration presets, a renter-name field, and a live availability verdict, none of which apply to maintenance. _Why:_ an honest, maintenance-specific surface with Croatian copy consistent with the create panel ("Uredi nedostupnost").
- **DEC-EM6 — Mutations emit audit events via the AuditWriter port.** The sibling change-unit at `system/context/audit/features/audit-log/SPEC.md` injects an `AuditWriter` port into every bookings mutation use case; `editMaintenanceUseCase` must be built to receive and use it, recording a `maintenance.edit` event with before/after. _Dependency:_ if the audit change-unit lands after this one, wire the port as a required dependency now and note the ordering — do not silently skip the audit write.

## Acceptance Criteria

- An operator can edit a maintenance block that has not yet ended — changing quantity, start time, end time, and/or notes — and the change is saved.
- Editing a maintenance block does NOT run a capacity/fits check (over-commitment remains allowed, per DEC-P3).
- A maintenance block that has fully ended (`end <= now`) or is cancelled is not editable (mapped to IMMUTABLE_PAST / NOT_FOUND).
- On save, `endTime` must remain after `startTime`, and quantity must stay within 1..8; violations are rejected with a mapped validation error.
- The edited block is reflected immediately on the board (the route revalidates after mutation).
- Reservations continue to be edited via the existing reservation-edit path — unchanged and unaffected.
- Each edit emits a `maintenance.edit` audit event capturing before/after (dependent on the sibling audit change-unit; see DEC-EM6).

## Tasks

- [ ] T1 — Domain + application: add `EditMaintenanceInput` type and `canEditMaintenance(booking, now)` pure predicate; new `editMaintenanceUseCase` (+ capability sidecar) that loads by id, gates on `canEditMaintenance`, merge-validates (endTime > startTime, quantity range, NO fits()), recomputes durationMin, calls `repo.update`, and returns a Result. Accepts and uses the AuditWriter port (records `maintenance.edit` with before/after). Reuses existing `IBookingRepository.update` — no repo change. (owner: donnie)
- [ ] T2 — Add `editMaintenanceAction` to the app server actions (five-step shape, epoch-ms dates, Croatian mapped errors, `revalidatePath('/')`). (owner: nexus)
- [ ] T3 — Build `MaintenanceEditContainer` ('use client' slim proxy) + `MaintenanceEditPanel` (pure): quantity 1–8 grid, Od/Do HH:MM inputs, notes, save/cancel; wire onto each editable maintenance row. No availability verdict. Croatian copy consistent with the create panel ("Uredi nedostupnost"). (owner: frankie)
- [ ] T4 — Architectural review. (owner: auditor)

## Change Log

<!-- ADD / MOD / DEL prefix; appended by implementing agents as work lands. -->

2026-07-02  donnie  T1 done. Domain predicate + application use case for maintenance edit.
  MOD  modules/bookings/domain/types.ts — ADD EditMaintenanceInput = { id: BookingId; quantity?; startTime?; endTime?; notes? } (DEC-EM3)
  MOD  modules/bookings/domain/booking.ts — ADD canEditMaintenance(booking, now) pure predicate: kind=maintenance AND status!=cancelled AND endTime>now (DEC-EM2); no Date.now() inside (donnie-rules §1)
  ADD  modules/bookings/application/editMaintenanceUseCase.ts — makeEditMaintenanceUseCase factory + pre-wired editMaintenance; load by id; kind check (NOT_FOUND if not maintenance); canEditMaintenance gate (IMMUTABLE_PAST); merge-validate (endTime>startTime; qty range); recompute durationMin; NO fits() check (DEC-EM1/DEC-P3); repo.update; audit record via AuditWriter (DEC-EM6); DEC-AU6 fail-open with CRITICAL log
  ADD  modules/bookings/application/editMaintenanceUseCase.capability.ts — sidecar; effect: bookings.maintenance.edited

2026-07-02  nexus  T2 done. editMaintenanceAction server action.
  MOD  app/actions.ts — ADD editMaintenanceAction (DEC-EM4): five-step adapter shape (server-actions.md §1); id required; quantity/startTimeMs/endTimeMs optional (validated only if present); startTime/endTime reconstructed from epoch-ms; notes empty-string→null (clear), absent→undefined (no change) — mirrors editBookingAction; calls editMaintenance({ id, quantity, startTime, endTime, notes, context: await auditContext() }); on failure returns { success:false, code, message: mapError(code) }; on success revalidatePath('/') + return { success:true }. File-header comment block already carried "ADDED (DEC-EM4): editMaintenanceAction." — function now exists to match it.

<!-- AUTO:WORKLOG — appended (never overwritten) by the auditor on every run -->
## Worklog

2026-07-02  auditor  engineering review  PASS with notes  editMaintenanceUseCase + canEditMaintenance + UI reviewed as part of the joint audit-log change-set. Backend correct; UI under-exposes DEC-EM2. Primary CARD/VERDICT live in the audit-log SPEC.

2026-07-02  auditor  delta re-audit  RESOLVED  DEC-EM2 UI/domain mismatch fixed. BookingRow.tsx now gates the maintenance edit affordance on isMaintenanceEditable (kind=maintenance && status!='cancelled' && endTime>now) — exact mirror of canEditMaintenance, guard = isPending || isMaintenanceEditable. CURRENT (running) maintenance blocks now surface the edit button; reservations remain future-only; pure prop-derived boolean using the injected now (no hooks/Date.now); routes to MaintenanceEditContainer. Prior concern CLEARED. tsc GREEN. Primary CARD/VERDICT remain in the audit-log SPEC.

<!-- /AUTO:WORKLOG -->

<!-- AUTO:VERDICT — overwritten by the auditor on every run -->
## Verdict
**PASS with notes** · 2026-07-02T00:00:00Z  (reviewed jointly with the audit-log change-set; primary CARD lives in system/context/audit/features/audit-log/SPEC.md)

Backend is correct and faithful to the DECs. `editMaintenanceUseCase` is a separate use case (DEC-EM1), runs NO fits()/capacity check (DEC-EM1/DEC-P3), rejects non-maintenance kinds with NOT_FOUND, gates on the pure `canEditMaintenance` predicate (IMMUTABLE_PAST), merge-validates endTime>startTime and quantity range, recomputes durationMin, and records a `maintenance.edit` audit event with before/after via the AuditWriter port under DEC-AU6 fail-open (DEC-EM6). `canEditMaintenance(booking, now)` in domain/booking.ts is a pure predicate — no Date.now(), `now` passed in (donnie-rules §1), policy lives in domain (§6.1), shell stays thin (§6.7). `editMaintenanceAction` follows the five-step adapter shape (presence-validate id only, one use case, revalidatePath('/'), mapped Croatian errors, epoch-ms serialization — DEC-EM4). Frankie's `MaintenanceEditPanel` is pure (no hooks/'use client'), `MaintenanceEditContainer` is a slim 'use client' proxy delegating all JSX, no availability verdict is shown, and the accessibility floor is met (htmlFor labels, aria-pressed, role=group, role=alert/aria-live, focus-visible rings).

**Concern (DEC-EM2 UI/domain mismatch) — RESOLVED 2026-07-02 (delta re-audit).** The prior concern: the edit affordance in `app/_components/BookingRow/BookingRow.tsx` rendered only inside the `isPending` ActionBar (startTime>now), narrower than DEC-EM2's `endTime>now`, so a CURRENT (started-but-not-ended) maintenance block showed no edit button even though `canEditMaintenance` allowed it. Frankie remediated: `BookingRow.tsx` now computes `isMaintenanceEditable = isMaintenance && status !== 'cancelled' && endTime > now` — an exact mirror of `canEditMaintenance(booking, now)` and consistent with the row's own `canCancel`-aligned cancel gate — and the ActionBar guard is now `isPending || isMaintenanceEditable`. CURRENT maintenance blocks now surface the edit affordance (routing to `MaintenanceEditContainer`); reservations keep the unchanged future-only `isPending` gate; past and cancelled maintenance stay hidden. The new condition is a pure prop-derived boolean (no hooks, no `Date.now()`, uses the injected server `now`), so `BookingRow` remains a pure server component. Verified against the domain predicate at re-audit; no regressions, no new violations, tsc GREEN. The inaccurate change-log claim is superseded by the FIX 1 change-log entry below.

<!-- /AUTO:VERDICT -->

2026-07-02  frankie  T3 done. MaintenanceEditContainer + MaintenanceEditPanel + board wiring (DEC-EM5).
  ADD  app/_components/MaintenanceEditPanel/MaintenanceEditPanel.tsx — pure presentational component; exports MaintenanceEditState, MaintenanceEditPanelProps, MaintenanceEditViewProps, MaintenanceEditView (discriminated union: closed="Uredi" button / open=full edit panel — mirrors BookingEditView pattern), MaintenanceEditPanel; quantity 1–8 grid, Od/Do HH:MM time inputs, notes, Spremi/Odustani buttons, error banner; warning-token styling mirrors MaintenanceBlockPanel; Croatian copy "Uredi nedostupnost"; accessibility floor: htmlFor labels, aria-pressed on quantity grid, focus-visible rings, aria-live on error banner; NO availability verdict (DEC-EM1/DEC-P3).
  ADD  app/_containers/MaintenanceEditContainer/MaintenanceEditContainer.tsx — 'use client' slim proxy; pre-fills from booking (formatHHMM for time strings); client-side validates end>start (Croatian error); builds FormData {id, quantity, startTimeMs, endTimeMs, notes}; calls editMaintenanceAction inside useTransition; closes on success, shows result.message on failure; delegates ALL JSX to MaintenanceEditView (react-components.md §4).
  MOD  app/_components/BookingRow/BookingRow.tsx — ADD import MaintenanceEditContainer; ADD to ActionBar: maintenance rows render MaintenanceEditContainer, reservations render BookingEditContainer — gated by isMaintenance flag; isPending gate (startTime>now, status!='cancelled') already satisfies DEC-EM2 canEditMaintenance conditions.

2026-07-02  frankie  auditor-remediation FIX 1 — correct maintenance edit affordance gating per DEC-EM2 (auditor concern: maintenance edit gated on isPending/startTime>now rather than endTime>now).
  MOD  app/_components/BookingRow/BookingRow.tsx — ADD isMaintenanceEditable computed flag (kind=maintenance AND status!='cancelled' AND endTime>now, mirroring canEditMaintenance); change outer ActionBar guard from `isPending` to `isPending || isMaintenanceEditable` so CURRENT (running) maintenance blocks surface the edit affordance; update ActionBar comment to document both gates. Reservations keep existing isPending gate unchanged.
