---
description: "DDD layer cake, module isolation, public API surface. Stack-agnostic — applies to any code in modules/** or packages/@core/**. Read by any agent touching those files and by the auditor on every audit of module code."
paths:
  - "modules/**"
  - "packages/@core/**"
---

# ddd-architecture.md — DDD layer rules

This file is the contract for Domain-Driven Design layer boundaries. It applies to any code in `modules/**` or `packages/@core/**`, regardless of which agent wrote it. The auditor reads it when the diff touches those paths.

This file is **stack-agnostic for DDD**. Agent-specific guidance lives in per-agent rule files (e.g., `donnie-rules.md`).

---

## §1 — The layer cake (DDD data flow)

```
Frontend (components/containers)
  → Server Actions (actions.ts)
    → Use Cases (application/)
      → Repositories (infrastructure/repositories/)
        → External Services (database, APIs, storage, third-party)
```

Each layer calls **only the layer directly below it**. Skipping a layer is a **violation**.

**Why:** The layer cake is what lets you replace a layer without rewriting the world. Frontend changes don't ripple to the database; a new ORM doesn't rewrite the domain. Each layer pays a small cost (one indirection) to buy a large reward (independent evolvability).

**Concrete signals:**
- A component imports from `application/` or `infrastructure/` → violation.
- A use case file imports an ORM / db client / schema directly → violation.
- A server action calls `fetch()` or an SDK directly instead of going through a use case → violation.
- A domain file imports from `application/` or `infrastructure/` → violation (domain depends on nothing external).

---

## §2 — Module isolation (Axiom of Isolation)

Core packages (`packages/@core/*`) **never import each other**. They are blind to each other. Cross-module relationships are expressed as **soft links** (plain string IDs), not via imports or foreign keys.

**Why:** Isolation is what makes core packages reusable across unknown future projects. The day you ship `@core/identity` to a downstream project that doesn't have your `@core/iam` doesn't break, because identity never depended on iam.

**Concrete signals:**
- `packages/@core/auth/**` imports from `packages/@core/iam/**` → violation.
- A core module's schema declares a foreign key to another module's table → violation.
- `modules/*` imports from `packages/@core/*` is allowed; the reverse is not.

---

## §3 — Public API surface — fully direct imports, no barrels

Modules use **fully direct imports**. There is no `index.ts` barrel, no `use-cases.ts` composition file, no re-export shim of any kind. Each use case file exports its own pre-wired instance.

**Why:** Barrels look convenient but they break tree-shaking, hide circular dependencies, and create silent coupling — touching one barrel re-exports rippling through every consumer. Direct imports keep the dependency graph honest.

From `app/`, only these import paths are public:
- `@/modules/{module}/application/{verb}{Entity}UseCase` — pre-wired use case instance
- `@/modules/{module}/domain/types` — public type definitions
- `@/modules/{module}/infrastructure/session` — session utilities only
- `@/packages/@core/*` — core types

**Concrete signals:**
- `app/` imports from `modules/*/infrastructure/repositories/**` → violation.
- `app/` imports from `modules/*/infrastructure/nucleus` → violation.
- `app/` imports from `modules/*/domain/*` (anything except `domain/types`) → violation.
- A new `index.ts` barrel or `use-cases.ts` composition file → violation. (Schema directory `index.ts` is the single exception — see `archie-rules.md` §1.)

---

## §4 — Code shape (one use case per file, no service classes)

- **One use case per file.** A file in `application/*UseCase*` exports exactly one `make*UseCase` factory. Multiple in one file → **violation**.
- **Higher-order factories, not service classes.** `export class XService`, `XController`, `XManager`, `XHandler`, `XProvider` are forbidden. Error subclasses (`extends Error`) are the only allowed class pattern.
- **Capability sidecar (when the prover is present in the repo):** every `*UseCase.ts` has a co-located `*UseCase.capability.ts`. Missing sidecar → violation.

**Why one per file:** Each use case is independently importable, independently testable, and locatable by name. Monolithic service files blur boundaries between operations and grow into god-files.

**Why factories not classes:** Higher-order factories let the caller wire concrete dependencies at the call site — no DI container needed, no shared mutable state, tests trivial.

---

## §5 — Module internal structure

Every module follows this internal layout:

```
{module}/
├── domain/                 # pure heart — types + functions + repo interfaces
├── application/            # use case orchestration
└── infrastructure/         # repository implementations, external adapters
```

Database-backed modules also have:

```
{module}/schema/            # Drizzle table definitions, enums, relations
```

Dependencies point inward only: infrastructure depends on application and domain; application depends on domain; domain depends on nothing external.

**Why three layers:** Three layers are enough to separate "what the business decides" (domain), "what coordinated work it takes to accomplish that" (application), and "what infrastructure makes it happen" (infrastructure). Fewer layers blur concerns; more layers introduce ceremony.

---

## What the auditor checks against this file

When the diff touches files in `modules/**` or `packages/@core/**`, the auditor reads this file and reasons section-by-section. Severity:

- HIGH (FAIL): layer-skip imports; cross-core-module imports; cross-module FK; barrel files; multiple use cases per file; service class patterns; missing capability sidecar.
- MEDIUM (WARN): public-API surface breaches that are not yet hard-blocked by hooks.
- LOW (note): minor structural deviations.

Findings tagged by section (e.g., `§1 layer skip`, `§3 forbidden import`, `§4 multi-use-case file`).

---

*Canonical contract for DDD layer rules. Stack-agnostic. Read by any agent editing module code and by the auditor on every audit of those files.*
