---
description: "Top-level directory placement — which root folders own what, where business modules go versus core packages versus app code. Stack-agnostic; loads unconditionally for every agent every turn."
---

# project-structure.md — top-level directory placement

Where things go at the root of the repo. Read by every agent on every turn so file placement decisions stay consistent.

---

## §1 — The directory layout

| Directory | Owns | Examples |
|-----------|------|----------|
| `packages/@core/` | Nucleus core infrastructure — universal modules with zero application-specific knowledge | `packages/@core/identity/`, `packages/@core/iam/` |
| `packages/shared/` | Shared utilities, types, helpers used across all packages | `packages/shared/result.ts` |
| `modules/` | Business domain modules — application-specific features | `modules/campaigns/`, `modules/products/` |
| `app/` | Next.js routes, pages, layouts, server actions | `app/(app)/campaigns/page.tsx` |
| `registry/` | Nucleus CLI registry — building block definitions and presets | `registry/index.yml` |
| `system/` | Documentation, project identity, context files | `system/project/philosophy.md`, `system/docs/`, `system/context/` |

**Why this split:** Core packages are agnostic — they ship to unknown future projects, so they cannot reference business modules. Business modules are application-specific — they live in `modules/` because they don't propagate. Shared utilities sit below both. The split makes the propagation direction obvious from the path alone.

---

## §2 — Two iron rules

1. **Business domain modules ALWAYS go in `modules/{module-name}/`.** They follow the DDD internal structure (`domain/`, `application/`, `infrastructure/`). Business modules belong in `modules/`, not `packages/`.

2. **`modules/` imports from `packages/`; never the reverse.** Core packages are intentionally agnostic — they never reference business modules. Dependency flows one way.

**Why:** Reversing the flow (a core package importing from a business module) would couple the propagation engine to one project's domain. The day you ship `@core/identity` to a new project, you'd ship campaigns alongside it. The one-way flow keeps the core reusable.

---

## §3 — Module internal structure

Both `packages/@core/{module}/` and `modules/{module-name}/` use the same internal layout:

```
{module}/
├── domain/          # types + pure business functions + repository interfaces
├── application/     # use case orchestration
└── infrastructure/  # repositories, adapters, ORM implementations
```

Database-backed modules also have a `schema/` directory (Drizzle table definitions, enums, relations).

See `ddd-architecture.md` for the full layer rules.

---

## §4 — Module public API

Modules use **fully direct imports**. No barrels of any kind. Each use case file exports its own pre-wired instance.

Allowed import paths from `app/`:

| Import path | What it provides | Example |
|-------------|------------------|---------|
| `@/modules/{module}/application/{verb}{Entity}UseCase` | Pre-wired use case instance | `import { register } from '@/modules/nucleus/application/registerUseCase'` |
| `@/modules/{module}/domain/types` | Public domain types | `import type { ActionResult } from '@/modules/nucleus/domain/types'` |
| `@/modules/{module}/infrastructure/session` | Session utilities | `import { setSession } from '@/modules/nucleus/infrastructure/session'` |
| `@/packages/@core/*` | Core types (Principal, Policy, etc.) | `import type { Principal } from '@/packages/@core/identity'` |

See `ddd-architecture.md` §3 for the full Public API rules.

---

## §5 — Things that are NEVER allowed

- Creating a business domain module inside `packages/`. Business logic belongs in `modules/`.
- Importing from `modules/` inside any `packages/` file. Dependency flows one way.
- Creating new top-level directories without explicit approval.
- `index.ts` barrels, `use-cases.ts` composition files, or any re-export files except `schema/index.ts`.

---

## What the auditor checks against this file

When the diff adds files or changes top-level structure, the auditor verifies:

- Business modules live in `modules/`, not `packages/`. → **violation** if misplaced.
- Cross-direction imports (core → business) → **violation HIGH**.
- New top-level directories without justification → **concern**.
- Forbidden public-API surface breaches → **violation HIGH**.

Findings tagged with `project-structure §N`.

---

*Where files go is decided here. Stack-agnostic. The layer rules — what's allowed across those layers — live in `ddd-architecture.md`.*
