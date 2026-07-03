# Functional Specification — Jet Ski Booth Board

| | |
|---|---|
| **Product** | Jet Ski Booth Board ("the Board") |
| **Document type** | Functional Specification — describes *what* the system does and the rules it obeys. It contains **no** technology, architecture, data-storage, or implementation choices; those belong to the implementing engineer/agent and must not be inferred from this document. |
| **Nature** | Mobile-first, multi-device, single-resource availability board for same-day jet ski rentals |
| **Constraint** | Favour-grade: deliberately minimal so it can be built in roughly one day. Scope is cut accordingly. |
| **Decisions** | All locked (§6). No open questions. |

---

## 1. How to read this document

This is a **one-shot functional brief**. Read it fully before any work. Sections 2–5 give the *why* so that the many small decisions this spec doesn't spell out are resolved correctly: **optimise for a stressed person at a booth answering "can I rent this?" in seconds.**

This document defines **behaviour and rules only**. It does not state — and must not be read to imply — any programming language, framework, database, hosting, sync technology, or internal algorithm. Where logic must be exact (availability, lateness), it is given as **business rules plus worked examples**, never as code. The implementer is free to realise these rules however they choose, provided the observable behaviour and acceptance criteria (§16) are met.

---

## 2. Background & context

The client runs a **jet ski rental booth** on the Croatian coast and owns **8 jet skis**, rented in **30 / 45 / 60-minute** slots. The business is **highly seasonal and sharply peaked**: in summer, demand arrives in **sudden bursts** — clusters of tourists reaching the booth within minutes, some wanting a ski *immediately*, some wanting one *later the same day*.

All operations are **same-day, walk-up**. There is no advance or online booking and no multi-day planning — only the flow of people at the booth today. Staff currently track this on paper or from memory, which fails exactly at peak, when rentals overlap and skis come back late.

The Board is a **favour**: an external developer sets everything up and hands over a working link. The client performs **no configuration** — they open the link on a phone and use it.

---

## 3. Problem statement

> **At peak time in peak season, the operator cannot reliably answer "can I rent N skis at time T for D minutes?" — because rentals overlap and skis return late, cascading delays onto everyone behind them.**

Three compounding pressures:

1. **Burst demand** — several parties arrive within minutes, each wanting different quantities, start times, and durations. Mental arithmetic breaks down.
2. **Overlap** — with 8 units and short slots, rental windows constantly overlap; whether a new rental fits depends on every other active rental.
3. **Late returns** — a ski due back at 12:45 that returns at 12:58 keeps occupying capacity and threatens the 13:00 rental that counted on it. Delay ripples down the queue.

The Board absorbs all three and makes the answer **obvious and instant**.

---

## 4. Goals & non-goals

**Goals**
- Answer "does this rental fit?" correctly and instantly, and when it doesn't, state the next time it would.
- Show the whole day's bookings, with their details (who, what, when, how long, how many), and let the operator manage them in **a few taps, a few seconds**.
- Make late returns and their downstream risk impossible to miss.
- Keep all operators' devices showing the same, current picture.
- Require **zero setup or administration** from the client.

**Non-goals**
- Not a booking engine (no calendar, no future dates, no recurrence).
- Not a point of sale (no pricing, payment, deposits, invoices).
- Not a customer product (customers never use it).
- Not an optimiser (it never auto-reschedules — the human decides).

---

## 5. Stakeholders & personas

**P1 — Operator (primary, the only real user).** Seasonal booth staff, often a **young, minimally-trained summer hire**, sometimes the owner. Works **standing, outdoors, in bright sun, one-handed**, possibly with wet hands, under pressure from an impatient queue. Needs the Board **obvious with no training**, every common action one or two taps, large high-contrast text, nothing buried in menus, and **buttons over typing**. *Top need: "Can I say yes to this person, right now?"*

**P2 — Owner (secondary, the friend).** Owns the business and the skis; configures nothing. Glances at the Board through the day and likes a simple sense of how busy it was. Cares most that staff actually *use* it, so simplicity is non-negotiable. *Top need: "Is the day under control, and how did we do?"*

**P3 — Renter (non-user, the pressure source).** The tourist. **Never opens the Board.** Stands at the booth wanting a ski now or later today, often in a group. Their impatience is the constraint the design works against — every second of operator fiddling is awkward booth silence.

---

## 6. Assumptions, constraints & locked decisions

- **Same-day only.** The Board concerns **today**. No calendar, no future dates. *(Locked.)*
- **Capacity, not assignment.** Future rentals reserve a **quantity** of skis, never a specific machine. Identifying individual machines, if ever, happens only at the moment skis physically go out. *(Locked — see §17 enhancement 1.)*
- **Human in charge.** Late returns and conflicts are **surfaced**, never auto-resolved. The system never reschedules anyone. *(Locked.)*
- **Multi-device.** Multiple operators on multiple phones share one Board and one current picture. *(Locked — §13.)*
- **No money.** No pricing, payments, or financial records. *(Locked.)*
- **No client administration.** All parameters (§7) are fixed at setup by the developer; the client cannot and need not change them. There is no admin screen. *(Locked.)*
- **Favour-grade effort.** Scope is intentionally minimal to fit ~one day of build.

---

## 7. System parameters (fixed at setup, not client-editable)

| Parameter | Meaning | Default |
|---|---|---|
| Fleet size | Total jet skis available | **8** |
| Standard durations | Quick-pick rental lengths | **30 / 45 / 60 min** |
| Turnaround buffer | Time a returned ski is unavailable before it can be re-rented | **0 min** (set to e.g. 5 if refuelling time is wanted) |
| Late grace | How long past due before a rental is flagged late | **5 min** |
| No-show grace | How long past start (undispatched) before a booking is flagged a possible no-show | **5 min** |
| Local day | The calendar day and time zone the Board operates in | **Europe/Zagreb** |

---

## 8. Information captured & rental lifecycle

### 8.1 Information per booking
Each booking records:

| Information | Required | Allowed values / form | Purpose |
|---|---|---|---|
| Number of jet skis | yes | 1–8 | The quantity reserved |
| Start time | yes | "Now", or a time later today | When the rental begins |
| Duration | yes | 30 / 45 / 60, or a custom length | How long the skis are out |
| Renter name | no | short text | Quick human identifier ("Marko", "red-shorts group") |
| Description / notes | no | free text | Anything the structured fields can't hold ("wants to extend later", "group of 4 tourists") |
| Status | system-managed | see §8.2 | Where the booking is in its lifecycle |
| Skis already returned | system-managed | 0–quantity | Supports partial returns |

### 8.2 Statuses & transitions
- **Booked** — reserved, skis not yet handed out.
- **Out** — skis physically handed out and on the water; a due-back time is running.
- **Returned** — all skis back.
- **Cancelled** — voided; frees capacity.
- **No-show (flag)** — booked, start time passed beyond grace, never dispatched.

Transitions:
- Booked → **Send out** → Out (records the actual hand-out time, which starts the due-back clock).
- Booked → **Cancel** → Cancelled.
- Out → **Return (partial)** → still Out (increments returned count, frees those skis immediately).
- Out → **Return (all)** → Returned.
- Booked, start passed + grace, not dispatched → **No-show flag** (a hint, not an action; never auto-cancelled).
- Any non-terminal booking → **Edit** → values change and availability is recomputed.

---

## 9. Functional requirements

**Bookings list**
- **FR-1** The Board shall present all of today's bookings as a single, readable list, showing for each: quantity, time, duration, renter name (if any), notes (if any), and status.
- **FR-2** The list shall be intelligently grouped and ordered — skis currently **out** (soonest due first; **late ones red and pinned to the top**), then **upcoming** bookings in time order — rather than a flat dump.
- **FR-3** Returned and cancelled bookings shall drop out of the main view but remain viewable for today via a history toggle.

**Creating a booking**
- **FR-4** The operator shall create a booking by choosing quantity, start time, and duration, optionally adding a renter name and notes.
- **FR-5** While creating or editing, the Board shall continuously show a **live verdict**: either "fits, N skis free" or "doesn't fit, next N free at HH:MM" (per §10).
- **FR-6** A booking's start time shall not be set earlier than the present (except "Now").
- **FR-7** When a request does not fit, the operator shall still be able to **force it through ("book anyway")**, and the Board shall then reflect the resulting over-commitment honestly.

**Managing a booking**
- **FR-8** The operator shall hand out a booking's skis in one action ("Send out"), which records the hand-out time and begins its due-back countdown.
- **FR-9** The operator shall record returns, either all at once or as a partial count; returned skis free capacity immediately.
- **FR-10** The operator shall extend an active rental quickly (e.g. +15 / +30) or edit its duration directly.
- **FR-11** The operator shall edit any field of any non-terminal booking, and cancel any booking.

**Availability**
- **FR-12** The Board shall always show how many skis are free **now**; when none are free, it shall show the next time, and quantity, that becomes available today.
- **FR-13** Availability shall be derived live from the current bookings — never entered or maintained by hand.

**Lateness & risk**
- **FR-14** A booking that is out past its due time by more than the late grace shall be flagged **late** and pinned to the top.
- **FR-15** A late or extended rental shall continue to hold its skis until its return is recorded.
- **FR-16** Any upcoming booking that can no longer fit because of a late or extended rental shall be flagged **at risk**.
- **FR-17** A booked rental whose start has passed beyond the no-show grace, undispatched, shall be flagged as a possible **no-show** with a one-tap cancel; it shall never be cancelled automatically.

**Day handling**
- **FR-18** The Board shall present only today's rentals; at the start of a new local day it shall present a clean day, with the prior day's completed bookings retained for the optional report (§17).

---

## 10. Business rules (exact behaviour) & worked examples

**R-AVAIL-1 (Capacity).** At no instant may the number of jet skis committed across all active rentals exceed the fleet size (8).

**R-AVAIL-2 (Fit).** A proposed rental of **Q** skis over the window from its start to its end is permissible only if, **at every instant within that window**, (skis already committed by other active rentals) + Q ≤ 8. Equivalently: the *peak* commitment by others during the window, plus Q, must not exceed 8.

**R-AVAIL-3 (Boundary handoff).** A ski whose rental **ends exactly at time T** is available to a rental **starting exactly at time T**. The end of a window is treated as the moment the ski is free again; a 12:00–12:45 rental and a 12:45–13:30 rental do **not** conflict and may use the same ski. *(This is the exact overlap behaviour the client depends on; mishandling it is the classic failure of these tools.)*

**R-AVAIL-4 (Next opening).** When a request does not fit, the Board shall present the **earliest start time, at or after the requested start and within today, at which the requested quantity would fit** for the requested duration.

**R-AVAIL-5 (Turnaround).** If a turnaround buffer is configured (default 0), a returned ski stays unavailable for that buffer after its rental ends before it can be committed again.

**R-AVAIL-6 (Override).** The operator may force a non-fitting rental ("book anyway"); the Board records it and shows the over-commitment truthfully rather than hiding it.

**R-LATE-1.** A rental that is out and past due by more than the late grace is **late**.
**R-LATE-2.** A late rental's skis remain committed until their return is recorded — in effect, its window stretches to the present.
**R-LATE-3.** Any upcoming rental rendered un-fittable by lateness or extension is flagged **at risk**.

**R-NOSHOW-1.** A possible no-show is only ever flagged, never auto-cancelled.

### Worked example A — overlap & next opening
Fleet 8. Existing: **A** = 4 skis, 12:00–13:00; **B** = 2 skis, 12:30–13:15.
Commitment over time: 12:00–12:30 → **4**; 12:30–13:00 → **6**; 13:00–13:15 → **2**; after 13:15 → **0**.
A new request for **3 skis, 12:45–13:30**: peak others' commitment in that window is **6** (during 12:45–13:00). 6 + 3 = 9 > 8 → **does not fit**. The earliest start where 3 fit for 45 minutes is **13:00** (commitment there is 2; 2 + 3 = 5 ≤ 8). The Board shows: *"Doesn't fit — next 3 free at 13:00."*

### Worked example B — boundary handoff
Existing: 8 skis out, all due 13:00. A request for any quantity **starting 13:00** fits, because rentals ending at 13:00 release their skis at 13:00 (R-AVAIL-3). No false conflict.

---

## 11. Key scenarios (user journeys)

**S1 — Burst of walk-ups.** A party wants **4 skis at 12:00 for 60 min** → New, quantity 4, 12:00, 60, confirm ("fits, 4 free"). Twenty minutes later, **2 skis at 13:00 for 45 min** → New, 2, 13:00, 45, confirm. Both appear in the time-ordered list.

**S2 — Immediate rental.** Walk-up wants **2 skis now for 30 min** → New, 2, Now, 30; created and handed out in one flow. Two skis show as out, counting down to due time.

**S3 — Late cascade.** A 60-min rental due 12:45 isn't back at 12:51 → its row turns **red** and pins to the top; the 13:00 rental that needed those skis shows an **at-risk** flag. The operator resolves it physically; the Board's only job is to make the conflict visible.

**S4 — Full booth.** Walk-up wants 3 skis now; only 1 free → the verdict reads *"Doesn't fit — next 3 free at 13:15."* The operator quotes a real time, or overrides if they know better.

**S5 — Partial return.** A group of 4 brings back 2 early → open the row, Return, set count 2, confirm. Two skis free immediately; the booking stays out with 2 remaining.

**S6 — End of day.** The owner opens the Board, sees the day winding down, and (optional) glances at the daily summary.

---

## 12. Interaction & usability requirements (functional)

These define *required behaviour and effort*, not visual or technical implementation.

- **U-1 Single working surface.** One primary screen (the day's bookings + live availability) plus one create/edit panel. No deep navigation.
- **U-2 Predefined-first.** Common choices are one-tap presets: quantity by simple increment (1–8); start as **Now** or quick time presets; duration as **30 / 45 / 60**; row actions **Send out / Return / Extend / Edit / Cancel**.
- **U-3 Escape hatches.** Every preset has a manual fallback: a custom start time, a custom duration, free-text renter name and notes, and the **book-anyway** override. The structured path is fast; the escape hatch covers the unusual.
- **U-4 Effort ceilings (must hold):** create a booking in **≤ 4 taps** (name/notes skippable); send out **1 tap**; return all **1 tap**; return partial **≤ 2 taps**; extend **1 tap**; cancel **≤ 2 taps** (action + confirm).
- **U-5 Glanceability.** Free-now count, what's out and when it's due, and anything late or at-risk must be readable at a glance without scrolling past the fold on a phone.
- **U-6 Field-ready.** Large, high-contrast, sunlight-legible text; comfortable touch targets; one-handed operation; no onboarding — obvious cold.
- **U-7 Safe actions.** Destructive actions (cancel, force-return) confirm or are undoable.

---

## 13. Multi-device behaviour (functional)

- **M-1 Shared Board.** All operators access the same single Board; there are no per-device or per-person separate states.
- **M-2 Consistency.** A change made by one operator (new booking, send out, return, edit, cancel) appears on every other operator's device promptly — within a few seconds.
- **M-3 Conflict convergence.** If two operators change the same booking at nearly the same moment, the most recent change prevails and all devices converge on the same result; no device is left showing a stale or divergent picture.
- **M-4 Availability is recomputed against the shared, current set of bookings**, so every device gives the same fit answer for the same request at the same time.
- **M-5 Shared clock.** All devices judge "now", due times, and lateness against one consistent notion of the current time, so a rental is "late" identically everywhere.
- **M-6 Resilience.** A brief loss of connectivity must not lose an operator's action; on reconnection the Board returns to the shared, consistent picture.

*(How sharing, propagation, and convergence are achieved is an implementation choice and is intentionally unspecified here.)*

---

## 14. Edge cases & rulings

| Case | Ruling |
|---|---|
| Late return | Red, pinned, keeps holding skis until returned; dependent upcoming rentals flag at-risk. No auto-push. |
| No-show | Flagged after start + grace; one-tap cancel; never automatic. |
| Full booth | Free-now and the create-verdict show the next opening time and quantity. |
| Partial dispatch / return | Returns are a count; freeing skis re-opens capacity at once. |
| Extend mid-rental | Quick +15/+30 or edit duration; downstream recompute; newly-broken rentals flag at-risk. |
| Back-to-back realism | Optional turnaround buffer (default none). |
| Past start time | Blocked except "Now". |
| Concurrent edits | Latest change wins; all devices converge (M-3). |
| New day | Board shows a clean today; prior completed bookings retained for the report. |
| Unusual request | Custom duration / custom time / free-text notes cover whatever presets cannot. |

---

## 15. Out of scope (do not build)
Multi-day calendar, future dates, recurrence · pricing, payments, deposits, invoices · customer accounts or customer-facing booking · notifications of any kind (SMS / email / push) · assigning specific machines to *future* bookings · automatic rescheduling of the queue · maintenance, fuel, staff, or multi-location management · any client-facing administration or settings screen. **Anything not explicitly required in §9 or listed in §17 is out of scope.**

---

## 16. Acceptance criteria (observable, functional)
- [ ] All operators' devices reflect any change to the Board within a few seconds.
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

---

## 17. Optional / future enhancements (only after the above is solid; cut first under time pressure)
1. **Machine labels.** Name the 8 skis; when skis are handed out, optionally tag which physical machines went, so "out now" can read "Ski 3, Ski 5". Future bookings never reference specific machines (keeps the capacity model intact).
2. **Daily report.** A simple end-of-day summary from completed bookings: number of rentals, total ski-hours, peak simultaneous usage, busiest hour, average duration, count of late returns.
3. **Day timeline.** A simple visual of free-count across the day.
