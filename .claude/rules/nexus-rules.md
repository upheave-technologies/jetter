---
description: "Nexus-specific contract for Next.js server-side data orchestration — the handoff with frankie, caching strategy, auth gates, runtime selection, security at the edge. Read by nexus when producing pages/actions/route handlers/middleware/caching, read by the auditor when verifying."
paths:
  - "app/**/page.tsx"
  - "app/**/layout.tsx"
  - "app/**/template.tsx"
  - "app/**/actions.ts"
  - "app/**/actions.tsx"
  - "app/**/route.ts"
  - "app/**/error.tsx"
  - "app/**/loading.tsx"
  - "app/**/not-found.tsx"
  - "middleware.ts"
---

# Nexus's Rules

Nexus-specific rules for the Next.js server-side data layer. The cross-cutting rules live in the stack files: `page-architecture.md` (page contract), `server-actions.md` (action shape), `server-first-react.md` (server-first principles), `react-components.md` (React conventions), `ddd-architecture.md` (layer cake), and `architecture.md` (mindsets). All those auto-inject when nexus touches matching files.

This file is the **nexus specialization** of those rules — what nexus must do beyond the cross-cutting contracts.

## Scope

Nexus owns: `app/**/{page,layout,template,actions,route,error,loading,not-found}.{ts,tsx}` and root `middleware.ts`. Plus `generateMetadata`.

Out of scope: `app/**/_components/**`, `app/**/_containers/**` (frankie); business logic / use cases / repositories (donnie); database schema (archie); any JSX rendering, design tokens, or styling decisions (frankie).

---

## §1 — The nexus → frankie handoff

Nexus produces the data layer; frankie produces the JSX. The boundary is hard.

- **Nexus's output:** `page.tsx` with auth → authorization → URL parsing → data fetching → `return null`. Frankie replaces `null` with a single component invocation later.
- **Frankie's output:** modifies only the `return` statement and adds component imports. Frankie does not touch auth, authorization, or data fetching.
- Both states of `page.tsx` are valid (`return null` in nexus phase; `return <PageView />` in frankie phase). The auditor checks consistency, not a single specific state.

**Why this split:** Specialization. Nexus understands auth/data; frankie understands visual presentation. Mixing them produces files that nobody owns cleanly. The handoff means each agent reads the file at a known state and modifies only its surface.

Nexus never edits frankie's components. Frankie never adds data fetching, server actions, or auth.

---

## §2 — Authentication and authorization gates

Every protected page and server action starts with these two checks in order:

1. **Session resolution** — `const session = await getSession()`. If null:
   - Pages → `redirect('/login')`
   - Server actions / route handlers → return `{ success: false, code: 'UNAUTHENTICATED' }`

2. **Ability check** — `const ability = await buildAbility({ principalId: session.principalId })`. If `!ability.can(action, subject)`:
   - Pages → `redirect('/unauthorized')`
   - Server actions / route handlers → return `{ success: false, code: 'FORBIDDEN' }`

Skipping either on a protected route → **violation HIGH**.

**Why two checks at the gate AND the use case:** Nexus's gate stops obvious unauthorized requests at the edge — cheap, no DB round-trip needed beyond session validation. The use case re-checks authorization (donnie-rules §3) as the safety net — the day a different caller (a CLI, a worker) reaches the use case, the policy still holds. The defense is at both layers because a single layer is one bug away from a privacy incident.

**The session is the source of truth for `tenantId` and `principalId`.** Never trust those from `FormData`, `searchParams`, or request body. Client-supplied IDs identify nothing → **violation HIGH**. (See `architecture.md` §2.)

---

## §3 — Caching strategy (Next.js 16 + React 19)

Next.js 16 caching is opt-in and explicit. Nexus chooses the strategy on every route segment and every cached function.

### §3.1 — Choose the strategy explicitly

Every route segment chooses one:
- **Static, indefinite:** `export const dynamic = 'force-static'`
- **ISR (time-based revalidation):** `export const revalidate = N` (seconds)
- **Dynamic per-request:** `export const dynamic = 'force-dynamic'`
- **Fine-grained per-call:** `unstable_cache` or `'use cache'` directive per function

A route serving personalized/authenticated data with no explicit declaration → **concern**. Always declare.

**Why explicit:** Next.js's inferred caching changes between versions. Authenticated routes that accidentally cache leak data across users. Public routes that accidentally don't cache crush the database. Declaring intent at the segment makes the contract visible.

### §3.2 — Tag everything cacheable; invalidate on mutation

- Every `unstable_cache` call passes `tags`. Missing → **violation HIGH**.
- Every mutating server action calls `revalidatePath` or `revalidateTag` if it affects cached data. Missing → **violation**.

**Why:** Cached data without an invalidation handle is uninvalidable garbage. The cache becomes a stale-data source that nobody knows how to fix.

### §3.3 — Don't cache user-specific data with shared keys

`unstable_cache(fn, ['user-data'], ...)` without the principal/tenant ID in the key array → **violation HIGH**. Data leaks across principals.

```typescript
// ✅ Principal-scoped cache key
unstable_cache(getUserData, ['user', principalId], {
  tags: [`user-${principalId}`],
});
```

**Why:** The cache key is the cache's identity. Sharing a key across users means sharing data across users — a privacy incident waiting to happen.

### §3.4 — Request-scoped dedupe via `React.cache()`

For functions called multiple times within one render (a layout and its page both calling `getSession()`), wrap with `React.cache()`. Request-scoped only — not cross-request. Avoid redundant calls inside a render.

### §3.5 — `'use cache'` directive (Next 16+)

`'use cache'` caches a function's result across requests by inputs. Don't use inside functions that read cookies / headers / session — those values are part of the inputs implicitly, and the cache will leak across users → **violation**.

---

## §4 — Streaming and parallel fetching

- **Independent fetches MUST be parallelized with `Promise.all`.** Sequential `await` of independent calls → **violation**. Request waterfall is 2-3× slower wall-clock.
- Route segments with known-slow data have a `loading.tsx` sibling. Missing on a slow route → **concern**.
- Slow leaf components wrap in `<Suspense fallback={...}>`. Nexus inserts the boundary; frankie supplies the fallback.

**Why:** A page that does three independent fetches sequentially takes the sum of three latencies. The same page done in parallel takes the max. The user feels the difference.

---

## §5 — Route handlers vs server actions

Use a **route handler** (`route.ts`) when:
- The endpoint is consumed by external systems (webhooks, third-party callbacks, JSON-API clients).
- The payload is non-form (binary, streaming, file uploads with custom headers).
- The endpoint must be addressable by a stable URL.

Otherwise → **server action**. Internal-form mutations routed through `/api/*` instead of server actions → **concern**.

**Why:** Server actions have built-in CSRF protection, work seamlessly with `<form action={}>`, and produce smaller bundles. Route handlers exist for the cases server actions can't cover.

### Webhook handlers (POST route.ts from external systems)

- **Signature/origin verification FIRST.** Before parsing any payload. Missing → **violation HIGH**.
- **Idempotency is mandatory.** The use case the route handler calls must check for prior execution or rely on a schema-level unique constraint. Missing → **violation HIGH**.
- **HTTP status discipline.** 2xx on success, 4xx on bad signature/payload, 5xx ONLY on genuine server failure. Returning 5xx on "already processed" causes infinite retry storms → **concern**.

---

## §6 — Middleware (middleware.ts)

Middleware runs at the edge. Constraints are tight:

- **Stateless.** Verify session cryptographically; don't query the database. Edge runtime has no DB connection (typically) → **violation** if DB access present.
- **Edge-safe imports only.** No Node built-ins (`fs`, `child_process`), no ORM, no Node-only crypto forms → **violation**.
- **Narrow `config.matcher`.** Don't run on static assets / public pages unless required → **concern**.
- **Authorization at middleware is coarse.** Fine-grained policy belongs in pages and use cases (the safety net pattern from §2).

---

## §7 — Runtime selection (edge vs node)

Routes default to the Node runtime. Switch to `export const runtime = 'edge'` ONLY when:
- The route does no DB work and no Node-only operations.
- Low latency / global distribution matters more than capability.

Stay on Node when:
- The route calls a use case that hits the database.
- The route uses Node-only APIs (`fs`, `Buffer`, certain `crypto` forms).

Mixing runtimes without intent → **concern**.

**Why:** Edge runtime is a strict subset of Node. Putting DB-touching code on the edge will not work; putting purely computational code on Node misses a latency win. Choose deliberately.

---

## §8 — Security at the edge (beyond architecture.md §2)

The mindset is in `architecture.md` §2. Nexus's concrete enforcement:

- **No secrets in `NEXT_PUBLIC_*` env vars.** `NEXT_PUBLIC_*` is browser-exposed. Server-only secrets stay in non-prefixed env vars accessed from server context → **violation HIGH** if violated.
- **CSRF on server actions** is built-in (Next.js same-origin protection). Don't disable.
- **No `eval`, no `Function(string)`.**
- **Don't echo user input in error responses.** Use mapped error codes; the user gets `'VALIDATION_ERROR'`, not their unvalidated string.
- **Public-facing route handlers (internet POSTs) need rate limiting.** Vercel built-in or Upstash. Missing → **concern**.
- **No secrets in any log line.** (Same as `architecture.md` §2 — restated here at the route boundary where logs first appear.)

---

## §9 — Error UX (notFound vs throw)

- `notFound()` from `next/navigation` for expected-missing cases → renders `not-found.tsx` (404 UX).
- `throw` for unexpected errors → renders `error.tsx` (500 UX).
- They are different errors with different fixes. Throwing for expected-missing → **concern**.

---

## §10 — Observability propagation

- Server actions and route handlers log entry (with input shape, not values) and exit (with success/code).
- Nexus propagates the request's correlation ID into use case calls.
- Caught errors get reported (Sentry/equivalent) before being mapped to `ActionResult`.

---

## What the auditor checks against this file

When the diff touches files under nexus's paths, the auditor reads this file (plus the stack files page-architecture.md, server-actions.md, server-first-react.md, react-components.md) and reasons section-by-section. Severity:

- HIGH (FAIL): missing auth check on protected route; cached personal data with shared key; missing `revalidatePath` / `revalidateTag` after mutation; webhook endpoint without signature verification or idempotency; `NEXT_PUBLIC_*` containing a secret; sequential `await` of independent calls; client-trusted principal/tenant ID; missing rate limit on internet-facing POST handler.
- MEDIUM (WARN): missing `loading.tsx` on slow route; route handler used where a server action would do; runtime mixed without intent; route handler returning 5xx on "already processed."
- LOW (note): minor deviations from documented shape; missing inline comment on a non-obvious caching choice.

Card section: `nexus's rules — nexus-rules.md`. Findings tagged by section (e.g., `§3.3 shared-key cache leak`, `§2 missing auth gate`, `§5 webhook missing idempotency`).

No softening. False positives are cheaper than false negatives.

---

*Nexus-specific rules. Cross-cutting stack rules live in `page-architecture.md`, `server-actions.md`, `server-first-react.md`, `react-components.md`, `ddd-architecture.md`. Engineering mindsets live in `architecture.md`. Templates, workflow, completion protocol live in `.claude/agents/nexus.md`.*
