---
description: "React component conventions — taxonomy of _components vs _containers, hooks containment, what TSX files may import. Stack-agnostic — applies to any agent touching .tsx files."
paths:
  - "app/**/*.tsx"
  - "app/**/_components/**"
  - "app/**/_containers/**"
  - "components/**"
---

# react-components.md — React/TSX conventions

This file is the contract for React components. Stack-agnostic — applies to any agent editing `.tsx` files in `app/**`, `app/**/_components/**`, `app/**/_containers/**`, or `components/**`. Frontend-specific concerns (design system, accessibility floor, performance) live in `frankie-rules.md`.

---

## §1 — The boundary

TSX files (pages, layouts, components, containers) sit at the top of the data flow:

```
TSX files → Server Actions (actions.ts) → Use Cases → Repositories → External Services
```

TSX files call Server Actions. Server Actions call Use Cases. No shortcuts through this chain.

**Why:** This is R1 of the layer cake. If TSX files reach into use cases or repositories directly, the entire encapsulation collapses — front-end code becomes tightly coupled to backend internals, and the day you swap the ORM, the components rewrite too.

---

## §2 — Forbidden in any `.tsx` file

- No ORM imports or database access (Prisma, Drizzle, Knex, Sequelize, raw SQL) → **violation HIGH**.
- No direct `fetch()` calls to external APIs → **violation HIGH**.
- No `axios`, `got`, or any HTTP client library → **violation HIGH**.
- No direct cloud storage access (S3, GCS, Azure Blob) → **violation HIGH**.
- No repository imports — repositories are infrastructure, not presentation → **violation HIGH**.
- No use case imports — use cases are called by Server Actions, not by components → **violation HIGH**.

The architecture-guard hook blocks these at write time.

---

## §3 — What belongs in `.tsx` files

- JSX rendering and component composition
- Client-side React hooks (`useState`, `useEffect`, etc.) — only in `_containers/` with `'use client'`
- Calls to Server Actions defined in `actions.ts`
- Reading props and URL params passed from Server Components
- Client-side form handling and UI state (when genuinely client-necessary)

---

## §4 — The `_components/` vs `_containers/` boundary

Two folders, two roles. The boundary is hard.

| Folder | Role | `'use client'` | Hooks | Raw JSX | State |
|---|---|---|---|---|---|
| `_components/` | Pure presentational. Props → JSX. | NEVER | NEVER (except `useFormStatus`) | YES | NEVER |
| `_containers/` | Data orchestrators or interactive leaves. | OPTIONAL — only when state/hooks/browser APIs are genuinely needed | YES (when client) | YES | YES (when client) |

**Why pure components:** Pure components are trivially testable, snapshot-friendly, and reusable across routes. The moment a component knows about state or effects, it's coupled to a runtime — it can't be rendered in isolation.

**`_components/` rules:**
- Receive everything as props. Return JSX. Period.
- No `useState`, `useReducer`, `useEffect`, `useContext`, `useRouter`, `useSearchParams`, `useTransition`, `useOptimistic`, `useQuery`, `useMutation`.
- `useFormStatus` is the **only** allowed hook — it serves pending form state in a server-rendered form.
- The architecture-guard hook hard-blocks other hooks in `_components/` at write time.

**`_containers/` rules:**
- Default to **server container** (no `'use client'`).
- Add `'use client'` ONLY when there's a genuine need: ephemeral UI state, browser APIs, real-time subscriptions (see `server-first-react.md` §3).
- Client containers must be **slim state proxies** — they manage state and event handlers, then delegate ALL rendering to `_components/` via a single child component call. Raw HTML JSX inside a client container → **violation** (architecture-guard Rule 14).

---

## §5 — The component hierarchy

When a page is data-driven (most common):

```
page.tsx (Server Component — auth, fetch)
  → _components/feature-view.tsx (pure props → JSX)
```

When data needs preparation, memoization, or composition:

```
page.tsx (Server Component — auth, fetch)
  → _containers/feature-container.tsx (Server Component — transforms, composes)
    → _components/feature-view.tsx (pure props → JSX)
```

When genuine interactivity is needed (forms with state, real-time, browser APIs):

```
page.tsx (Server Component — auth, fetch)
  → _components/feature-view.tsx (Server Component — most of the UI)
    → _containers/edit-form-container.tsx ('use client' — ONLY the interactive leaf)
      → _components/edit-form.tsx (pure props → JSX)
```

Data fetching is ALWAYS in Server Components (page or server container). `'use client'` is pushed to the smallest possible leaf. Most containers are server components.

---

## What the auditor checks against this file

When the diff touches `.tsx` files outside `_components/_containers/` territory, the auditor applies this file's rules. Severity:

- HIGH (FAIL): ORM/db/repo/usecase/fetch import in any `.tsx`; non-`useFormStatus` hook in `_components/`; raw HTML JSX in client `_containers/`.
- MEDIUM (WARN): unjustified `'use client'` in a container that has no state/effects/browser APIs.
- LOW (note): minor structural deviation.

Findings tagged `react-components §N`.

---

*Canonical contract for React/TSX file conventions. Stack-agnostic. The decision tree for whether a container becomes a client component lives in `server-first-react.md`.*
