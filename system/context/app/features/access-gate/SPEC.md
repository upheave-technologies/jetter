<!--
SPEC.md — working memory for one change-unit.

Lives at: system/context/app/features/access-gate/SPEC.md

This is an APP-LEVEL access gate, not a bookings-domain feature. It lives under a new
`app` module folder because it is cross-cutting plumbing above the whole application
surface (root middleware + a login route + an app-level auth helper), not domain logic
inside modules/bookings/. Nexus owns the server/data layer; Frankie owns the login UI.

It AUGMENTS — does not contradict — the bookings SPEC Decision DEC-P1 ("the Board has
no user accounts"). See DEC-AG1 below and the comment-provenance note in Scope/Out.
-->

---
id: app-access-gate
slug: access-gate
module: app
type: feature
state: done
created: 2026-07-01
updated: 2026-07-01
---

<!-- AUTO:CARD — overwritten by the auditor on every run -->
## CARD — engineering review · 2026-07-01T00:00:00Z
**verdict** PASS

**Changed files** 9
lib/auth.ts
middleware.ts
app/login/actions.ts
app/login/page.tsx
app/login/_components/LoginForm/LoginForm.tsx

**Findings** none

- No issues. Diff passes every applicable rule. Re-audit after remediation: the prior WARN concern (unkeyed SHA-256 token vs DEC-AG5) is now a human-accepted, documented trade-off in the amended DEC-AG5 — no longer an open finding. All 5 prior notes are resolved (isConfigured extracted into lib/auth.ts, verifyPassword deduped via expectedToken, three stale UI comments corrected). No regression: lib/auth.ts stays edge-safe (Web Crypto only), isConfigured reads only process.env, verifyPassword still fails closed.

<!-- /AUTO:CARD -->

## Intent

The Reservation Planning Board is currently open to anyone who can reach its URL. There
are no user accounts and no per-booking authorization — that is the deliberate design
(bookings SPEC Decision DEC-P1: "the Board has no user accounts"). But the operator wants
one brutally simple safety: only people who know a shared secret should be able to open
*any* part of the system.

This change adds a single **app-wide password wall** in front of the entire app. A visitor
who has not proven knowledge of the shared password is redirected to a login screen; once
they submit the correct password, a session is stored so they stay logged in across
browser restarts and do not have to re-enter it. The app serves a small number of trusted
people and holds no sensitive data, so a single shared password — not per-user auth — is
the right amount of security. Setup is one-time: the operator sets one environment
variable once.

Crucially, this does **not** reintroduce user accounts, principals, a database, or
per-booking authorization. It is one coarse gate above everything, and nothing below it
changes. DEC-P1 still holds inside the app; this gate simply sits above it. The existing
"no auth gate" comments at the top of `app/page.tsx` and `app/actions.ts` describe the
*per-user / per-principal* auth that remains absent — this change-unit must update those
comments so they distinguish "no per-user auth (still true)" from "there is now a coarse
app-wide password gate above the whole app."

## Scope

**In**
- A root `middleware.ts` that gates every route: a request without a valid auth cookie is redirected to `/login`.
- A `/login` route: a login screen and a server action that verifies the submitted password, sets the auth cookie on success, and redirects to the board (`/`).
- An app-level auth helper (app-layer cross-cutting plumbing, alongside the existing `lib/time.ts` / `lib/observability.ts` convention — NOT bookings-domain logic) that: reads the shared password from the `APP_PASSWORD` env var, derives a non-forgeable cookie value from it (a deterministic SHA-256 of `APP_SALT + ':' + password`, where `APP_SALT` is a fixed non-secret namespace constant — see DEC-AG5), and validates a presented cookie. Edge/Web-Crypto compatible so the same validation runs in middleware.
- The login screen UI (form, error state, "not configured" state) as `app/login/_components/**`.
- Updating the "no auth" provenance comments at the top of `app/page.tsx` and `app/actions.ts` so future readers understand the new coarse gate coexists with DEC-P1.

**Out**
- No user accounts, no principals, no `@core/auth` / `@core/identity` / `@core/iam` usage, no DB table for auth. DEC-P1 stands — this is a coarse gate, not per-user auth.
- No per-booking / per-route authorization. Once past the gate, every authed visitor sees and does exactly the same things as before.
- No logout in v1 (see DEC-AG6) — noted as deferred, not forgotten.
- No first-run setup wizard and no admin UI for the password — the password source is the `APP_PASSWORD` env var, set once in `.env.local` (gitignored).
- No password-strength rules, no rate limiting, no lockout-after-N-attempts, no account recovery — out of proportion for a single shared secret guarding non-sensitive data.
- No change to the bookings domain, schema, use cases, availability math, or any behavior below the gate.
- No `localStorage`-based session (see DEC-AG2 — the literal ask is deliberately deviated from, with reason).

## Decisions

1. **DEC-AG1 — Coarse app-wide gate, not per-user auth; augments DEC-P1 rather than contradicting it.** A single shared password gates the *whole app* via root `middleware.ts`. There are still no user accounts, no principals, no DB, and no per-booking authorization — DEC-P1's "the Board has no user accounts" remains literally true *inside* the app. This gate sits strictly *above* the entire surface: one password wall, not an auth system. This relationship is recorded explicitly so future readers and the auditor understand the middleware gate is intentional and not a violation of the documented "no auth" posture in `app/page.tsx` / `app/actions.ts`. **Rejected:** per-user accounts / principals via `@core/auth` (over-built for a handful of trusted users with no sensitive data — reintroduces exactly the account machinery DEC-P1 removed); leaving the app fully open (fails the operator's one stated safety requirement). **Why:** the operator asked for the minimum that keeps strangers out — one shared secret above everything is exactly that.

2. **DEC-AG2 — Session persisted in an httpOnly cookie, not localStorage (deliberate deviation from the literal ask).** The operator said "store it in localhost/localStorage." `localStorage` is invisible to server middleware and to server-rendered routes, so a `localStorage` flag cannot actually gate anything the server renders — the gate would be trivially bypassable and would not protect server routes at all. The session is therefore persisted in an **httpOnly cookie** that the edge middleware can read on every request. The UX is identical to what the operator wanted ("log in once, stay logged in"), but it actually protects every route. This is a conscious deviation from the verbatim request, recorded here with its reason. **Rejected:** `localStorage`/client-only flag (cannot gate server-rendered routes; not readable by middleware; bypassable); a bearer token in a header (nothing to attach it on plain navigations). **Why:** a cookie is the only session store that server middleware can enforce on every route, and it delivers the same "stay logged in" experience.

3. **DEC-AG3 — Password source is the `APP_PASSWORD` env var; this IS the one-time setup.** The shared password is read from `APP_PASSWORD`, set once by the operator in `.env.local` (gitignored). No first-run wizard, no DB table, no admin screen. **Rejected:** a DB-stored password with a setup flow (premature infrastructure for a single shared secret — violates the "brutally simple, no premature work" mandate); a hardcoded password in source (would be committed and public). **Why:** one env var is the simplest possible one-time setup that keeps the secret out of source control.

4. **DEC-AG4 — Fail closed when `APP_PASSWORD` is unset or empty.** If the password is not configured, the gate **blocks** access rather than allowing it, and a login attempt reports a clear "not configured" state. For a security feature, the safe default is a visible lockout, never a silent open door. **Rejected:** failing open when unconfigured (a misconfiguration would silently expose the whole app — the opposite of the feature's purpose). **Why:** a configuration mistake must degrade to "locked," and the "not configured" message tells the operator exactly what to fix (see architecture.md §2 — safe defaults at the trust boundary, §14 — actionable error state).

5. **DEC-AG5 — Non-forgeable cookie value: a deterministic SHA-256 of `APP_SALT + ':' + password` (unkeyed, resolved 2026-07-01).** The auth cookie's value must *prove knowledge of the password*, not be a trivially forgeable flag like `authed=1` (which anyone could set in devtools). The cookie token is a deterministic SHA-256 hex digest of `APP_SALT + ':' + password`, where `APP_SALT` is a **fixed, NON-secret namespace constant** (not a per-deploy secret key) — computed with the Web Crypto API so the same check runs in edge middleware. The cookie is `httpOnly`, `sameSite=lax`, `secure` in production, with a 1-year `maxAge` so people stay logged in across browser restarts. On each request the middleware recomputes the expected value from the current `APP_PASSWORD` and compares — so rotating `APP_PASSWORD` invalidates all existing cookies for free.

   **Keyed/HMAC-with-server-secret derivation was considered and explicitly DECLINED by the human on 2026-07-01.** The initial draft of this decision called for mixing a server-side secret into the derivation (HMAC-style); the delivered implementation used an unkeyed hash, which the auditor flagged as a concern. Presented with the trade-off, the human chose to keep it brutally simple: plain SHA-256, a single `APP_PASSWORD` env var, no second secret. **Rationale:** the threat model is "keep strangers out" for a small trusted group with no sensitive data behind the gate; the cookie is `httpOnly` (not XSS-stealable); adding a second required secret would undercut the "brutally simple, one-time setup" goal (a single env var, DEC-AG3). **Accepted residual risk:** if the `httpOnly` cookie ever leaked AND the shared password were weak, the token would be offline-guessable (there is no keying material to slow a brute force).

   **Rejected:** a keyed HMAC-SHA-256 using a per-deploy `APP_SECRET` (adds a second required secret — over-built for this threat model, undercuts one-time setup; declined by the human 2026-07-01); a plain boolean/flag cookie (forgeable by hand — provides no real gate); storing the raw password in the cookie (leaks the shared secret to every client). **Why:** the cookie has to be unforgeable-by-guessing-the-shape to be a gate at all, and an unkeyed SHA-256 over `APP_SALT + password` is edge-compatible, self-invalidating on password change, and the minimum that fits the stated threat model (architecture.md §2 — trust nothing at the edge; §12 — pragmatism and trade-offs).

6. **DEC-AG6 — No logout in v1.** There is intentionally no logout action or UI in this change-unit; the session simply persists until the cookie expires or is cleared. This keeps v1 brutally simple and can be added later (clear the cookie, redirect to `/login`). Recorded as deferred so it is a decision, not an omission. **Rejected:** shipping logout now (extra surface for a feature nobody has asked for yet — architecture.md §9, no premature work). **Why:** the stated need is "get in and stay in"; logout is a later, additive concern.

## Acceptance Criteria

<!--
Plain-English observable checks. Documentation of intent — the auditor does not run them.
Satisfaction basis: these ACs are advisory. There is no functional verifier / automated
prover in this phase, so each is satisfied by review + code inspection (auditor PASS,
zero findings — see AUTO:CARD/VERDICT), not by an automated behavior probe.
-->

- [x] **AC-1 — Unauthenticated access is gated.** Visiting any route without a valid auth cookie redirects to `/login`. (satisfied by inspection — `middleware.ts` gate)
- [x] **AC-2 — Correct password logs in.** Submitting the correct password sets the auth cookie and lands the user on the board (`/`). (satisfied by inspection — `app/login/actions.ts`)
- [x] **AC-3 — Wrong password is rejected.** Submitting an incorrect password shows an error on the login screen and does NOT set the auth cookie (the user stays gated). (satisfied by inspection — action returns INVALID_PASSWORD, never sets cookie on failure)
- [x] **AC-4 — Session persists.** Once authenticated, the cookie persists across browser restarts (long `maxAge`), so the user is not asked to log in again until the cookie is cleared or expires. (satisfied by inspection — 1-year `maxAge` in `lib/auth.ts`)
- [x] **AC-5 — No redirect loop.** The `/login` route itself and Next.js static assets (framework chunks, static files) are reachable without the auth cookie, so an unauthenticated visitor can actually see and use the login screen (no infinite redirect to `/login`). (satisfied by inspection — middleware matcher excludes `/login` + static assets)
- [x] **AC-6 — Fails closed when unconfigured.** With `APP_PASSWORD` unset or empty, the app blocks access (no route is reachable past the gate) and a login attempt reports a clear "not configured" state rather than silently letting anyone in. (satisfied by inspection — `isConfigured()` → NOT_CONFIGURED, DEC-AG4)
- [x] **AC-7 — Cookie is non-forgeable.** A hand-set cookie that does not prove knowledge of the password (e.g. `authed=1`) does not pass the gate; only a cookie whose value correctly derives from the configured password is accepted. (satisfied by inspection — SHA-256(`APP_SALT`:password) token, DEC-AG5)

## Tasks

<!--
Owner agents per the routing tree: nexus owns middleware, the login page data layer,
the login server action, and the app-level auth helper; frankie owns the login UI and
only after nexus has prepared the route; auditor reviews. Ordered so the data/gate layer
exists before the UI.
-->

- [x] **T1 — App-level auth helper** (owner: nexus)
  New `lib/auth.ts` (matching the `lib/time.ts` / `lib/observability.ts` app-layer convention). Reads `APP_PASSWORD` from the environment; derives a non-forgeable cookie value as a deterministic SHA-256 of `APP_SALT + ':' + password` (`APP_SALT` = fixed non-secret namespace constant, per resolved DEC-AG5) using the Web Crypto API (edge-compatible); exposes a validator that middleware and the login action both use; and exposes the cookie name / options (`httpOnly`, `sameSite=lax`, `secure` in prod, 1-year `maxAge`). Treats unset/empty `APP_PASSWORD` as "not configured" → fail closed (DEC-AG3, DEC-AG4, DEC-AG5).

- [x] **T2 — Root middleware gate** (owner: nexus)
  New root `middleware.ts`. On every request, validate the auth cookie via the T1 helper; if invalid/missing, redirect to `/login`. Exclude `/login` itself and Next.js static assets from the gate via the matcher / early-return so there is no redirect loop (AC-1, AC-5). Fails closed when unconfigured (AC-6, DEC-AG4).

- [x] **T3 — Login route data layer** (owner: nexus)
  New `app/login/page.tsx` as a server component that returns `null` in this phase (Frankie fills the JSX in T5). New `app/login/actions.ts`: a server action that presence-validates the submitted password, calls the T1 helper to verify it, sets the auth cookie and redirects to `/` on success, and returns a mapped result (wrong password / not configured) on failure — never setting the cookie on failure (AC-2, AC-3, AC-6). Optionally `app/login/loading.tsx` if useful. (nexus creates the action; frankie only calls it via `<form action={}>`.)

- [x] **T4 — Verify nexus output before UI** (owner: orchestrator)
  Confirm `middleware.ts`, `app/login/page.tsx` (returns null), `app/login/actions.ts`, and `lib/auth.ts` exist and the data/gate layer is in place before dispatching Frankie (the mandatory nexus → frankie gate).

- [x] **T5 — Login screen UI** (owner: frankie)
  Replace the `null` in `app/login/page.tsx` with the component tree; create `app/login/_components/**` — a password field, submit, error display, and the "not configured" state — using the existing design system tokens (Croatian UI copy, consistent with the board). Submits to the T3 server action via `<form action={}>`; never creates the action or reads/sets cookies itself (AC-2, AC-3, AC-6).

- [x] **T6 — Reconcile the DEC-P1 provenance comments** (owner: nexus)
  Update the "No auth gate" / "No auth step" header comments at the top of `app/page.tsx` and `app/actions.ts` so they distinguish "no per-user/per-principal auth — still true (DEC-P1)" from "a coarse app-wide shared-password gate now sits above the whole app in middleware.ts (DEC-AG1)." Keeps the documented posture honest post-change.

- [x] **T7 — Architectural review** (owner: auditor)
  Pass over the change-unit against `architecture.md` (esp. §2 trust-nothing-at-the-edge, safe defaults; §14 actionable errors; §9 no premature work), `project-structure.md`, `page-architecture.md`, `server-first-react.md`, `react-components.md`, `server-actions.md`, plus `nexus-rules.md` and `frankie-rules.md`. Specific checks: the cookie value is non-forgeable and derived, not a bare flag (DEC-AG5, AC-7); unconfigured `APP_PASSWORD` fails closed, never open (DEC-AG4, AC-6); the login action never sets the cookie on a wrong password (AC-3) and reads the password only from `APP_PASSWORD` (DEC-AG3, never from client input); the middleware matcher excludes `/login` + static assets so there is no redirect loop (AC-5); the login server action follows the five-step adapter shape and frankie only calls it (never creates it); the gate is coarse/app-wide and introduces no principals/DB/per-booking authz, so DEC-P1 is augmented not violated (DEC-AG1).

## Change Log

<!-- ADD / MOD / DEL prefix; appended by implementing agents as work lands. -->

Files touched in this change-unit (complete manifest):
2026-07-01  ADD  lib/auth.ts — app-level auth helper: reads `APP_PASSWORD`, `isConfigured()`, `expectedToken()` (SHA-256 of `APP_SALT`:password via Web Crypto, edge-safe), `verifyPassword`, `verifyCookieValue`, cookie name/options (httpOnly, sameSite=lax, secure-in-prod, 1yr maxAge).
2026-07-01  ADD  middleware.ts — root gate; validates auth cookie every request, redirects to `/login` when invalid/missing, matcher excludes `/login` + static assets, fails closed when unconfigured.
2026-07-01  ADD  app/login/page.tsx — server component login route.
2026-07-01  ADD  app/login/actions.ts — login server action (presence-validate → verify via helper → set cookie + redirect on success; INVALID_PASSWORD / NOT_CONFIGURED on failure; never sets cookie on failure).
2026-07-01  ADD  app/login/_components/LoginView/LoginView.tsx — login screen view.
2026-07-01  ADD  app/login/_containers/LoginFormContainer.tsx — form container wiring the server action.
2026-07-01  ADD  app/login/_components/LoginForm/LoginForm.tsx — password field, submit, error + "not configured" states (uses `useActionState`).
2026-07-01  MOD  app/page.tsx — comment-only: reconciled the DEC-P1 "no auth" provenance comment to distinguish "no per-user auth (still true)" from "coarse app-wide gate now above (DEC-AG1)".
2026-07-01  MOD  app/actions.ts — comment-only: same DEC-P1 provenance reconciliation.
2026-07-01  ADD  system/context/app/features/access-gate/HANDOFF.yaml — change-unit handoff record.
2026-07-01  NOTE  `app/login/_components/.../LoginFormStatus` was created during T5 then removed during the pending-state fix (folded into `useActionState`) — no longer exists in the tree.

Operator action (one-time setup, DEC-AG3/DEC-AG4):
2026-07-01  NOTE  One remaining operator action: set `APP_PASSWORD` in `.env.local` (gitignored). Until it is set, the gate is fail-closed by design (DEC-AG4) — no route is reachable and login reports "not configured." This is a one-time setup, not a code task.

2026-07-01  MOD  DEC-AG5 resolved — human explicitly DECLINED a keyed/HMAC-with-server-secret derivation (the auditor's WARN concern). Cookie token stays a deterministic SHA-256 of `APP_SALT + ':' + password` with `APP_SALT` a fixed NON-secret constant. Residual risk (offline-guessable if httpOnly cookie leaks AND password is weak) accepted. httpOnly / sameSite=lax / secure-in-prod / 1-year maxAge and rotate-`APP_PASSWORD`-invalidates-cookies all stand. Scope/In helper bullet and T1 wording reconciled to match.
2026-07-01  MOD  Current remediation pass cleaning up the 5 auditor NOTES: 3 stale comments (LoginForm/LoginForm.tsx, LoginFormContainer.tsx, LoginView.tsx — stale `useFormStatus`/"no hooks"/"passed as a child" references) + 2 minor helper refactors (app/login/actions.ts "is configured" predicate moved into lib/auth.ts; lib/auth.ts verifyPassword deduped against the expectedToken path). Re-audit + human commit approval still pending.

<!-- AUTO:WORKLOG — appended (never overwritten) by the auditor on every run -->
## Worklog

2026-07-01  spec  drafted SPEC (silent mode) for the app-wide shared-password access gate — new `app` module folder; captures DEC-AG1..DEC-AG6, 7 ACs, 7 tasks.
2026-07-01  auditor  engineering review  WARN  Gate is well-shaped and fail-closed; token derivation is unkeyed vs DEC-AG5 (concern); 5 notes (stale comments, minor encapsulation leaks).
2026-07-01  auditor  engineering review  PASS  Re-audit after remediation. DEC-AG5 concern now a documented human-accepted trade-off (amended decision); all 5 notes resolved (isConfigured extracted, verifyPassword deduped, 3 stale comments fixed). Refactor introduced no regression — still edge-safe and fail-closed. No findings.
<!-- /AUTO:WORKLOG -->

<!-- AUTO:VERDICT — overwritten by the auditor on every run -->
## Verdict
**PASS** · 2026-07-01T00:00:00Z

Re-audit of the full change-unit after the remediation pass. The gate remains architecturally sound: edge-safe (Web Crypto only, no DB/Node built-ins in middleware — nexus-rules §6), fails closed on unset `APP_PASSWORD` (DEC-AG4), never sets the cookie on a wrong password and distinguishes INVALID_PASSWORD from NOT_CONFIGURED (AC-3, AC-6), the middleware matcher excludes `/login` + static assets so there is no redirect loop (AC-5), the login action follows the five-step adapter shape with presence-validation only and a single decision call (server-actions.md §1), the client surface is the minimum irreducible leaf (server-first-react §4), and the login UI meets the accessibility floor (frankie-rules §5). The DEC-P1 provenance comments in `app/page.tsx` / `app/actions.ts` remain correctly reconciled (T6).

The prior WARN concern is closed. DEC-AG5 was amended to record that the human explicitly declined a keyed/HMAC-with-server-secret derivation on 2026-07-01, with rationale and an explicitly accepted residual risk (offline-guessable only if the httpOnly cookie leaks AND the shared password is weak). Under architecture.md §12 (pragmatism/trade-offs) and §16 (make the implicit explicit), a consciously recorded and human-accepted trade-off is not an open finding — it is a documented decision. The auditor does not re-litigate it.

All five prior notes are resolved with no regression introduced by the refactor: (1) `isConfigured()` is now a centralized predicate in `lib/auth.ts` reading only `process.env.APP_PASSWORD` — the login action imports it instead of re-reading env (arch §1); (2) `verifyPassword` and `verifyCookieValue` both route through the shared `expectedToken()` path (dedup, arch §9), and `verifyPassword` still fails closed (`expected === null → false`); (3–5) the stale `useFormStatus` / "no hooks" / "passed as a child" comments in `LoginForm.tsx`, `LoginFormContainer.tsx`, and `LoginView.tsx` now match the actual `useActionState` + direct-import shape (arch §8). `lib/auth.ts` is still edge-safe (no Node imports; `globalThis.crypto.subtle` only), every export has an in-repo consumer, and no orphaned or half-migrated code was left behind. No rule violations, no concerns, no notes.
<!-- /AUTO:VERDICT -->
