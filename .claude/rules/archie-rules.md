---
description: "Archie's complete database rulebook — the contract. Read by archie when designing schema, read by the auditor when verifying. Same file, same byte-string, no drift."
paths:
  - "modules/**/schema/**"
  - "packages/@core/*/schema/**"
  - "drizzle/**"
  - "drizzle.config.ts"
---

# Archie's Rules

The contract for the database layer. Producer reads this to know what's allowed; auditor reads it to verify. Engineering mindsets (encapsulation, security, Result types, idempotency, observability) live in `architecture.md`. The DDD layer rules (Axiom of Isolation, public API surface) live in `ddd-architecture.md`. Code templates, the Minimal Change Report format, schema-design workflow, and the user-approval procedure live in the agent body (`.claude/agents/archie.md`), not here.

## Scope

Archie owns: `modules/{name}/schema/**`, `packages/@core/{name}/schema/**`, `drizzle/migrations/**`, `drizzle.config.ts`.

Out of scope: repository implementations / use cases / domain logic (donnie); server-side data layer (nexus); UI (frankie). Schema changes are produced by archie and applied by the deploy pipeline — never by archie directly running `drizzle-kit push`.

---

## §1 — Schema layout

Every module's schema follows this layout:

```
{module}/schema/
├── enums.ts            # PostgreSQL enums shared across tables
├── {entity}.ts         # one file per entity table
├── relations.ts        # all Drizzle relations() calls
└── index.ts            # barrel re-export — the schema's public API
```

Required:
- One file per entity table. Multi-table mega-files → **concern**.
- All `relations(...)` calls collected in `relations.ts`. Scattered relations across entity files → **concern**.
- `index.ts` is the schema's public API. This is the **only** barrel allowed in the project (architecture-guard exempts it from the no-barrel rule).
- Shared enums in `enums.ts`. Single-table enums may live alongside the table.

---

## §2 — The Ten Commandments of Data Modeling

### I — Model the business first

Tables reflect business entities, not technical abstractions. `principals`, `tenants`, `entitlements` — yes. `entity_metadata`, `generic_data` — no. Table names that don't read like business concepts → **violation**.

### II — Normalize by default; denormalize with intent

Start at Third Normal Form. Denormalize only with explicit documented justification (measured query pattern, write-heavy workload, specific performance budget). "It might be faster" alone → **violation**.

### III — Enforce integrity at the database layer

Database-enforced constraints:
- `NOT NULL` on required columns. Optional columns are explicit, not default.
- `UNIQUE` constraints on logical keys (partial-index variant for soft-deletes — §4).
- `CHECK` constraints where the type system can't express the rule.
- Within-module relations may use FKs (with explicit `references` + `onDelete`/`onUpdate`).

Missing constraint that should be database-enforced → **violation**.

### IV — Soft links across module boundaries

Cross-module references use plain text UUID columns with NO `.references()`. This is the Axiom of Data Sovereignty.

Hard FK across module boundary → **violation HIGH** (`text('tenant_id').notNull().references(() => tenants.id)` where `tenants` is in another module).

**Why:** Hard cross-module FKs prevent the Reconciliation Engine from doing its job (it must be able to soft-delete and physically purge rows in one module without cascading locks across the whole database). They also break module isolation — the day you swap out `@core/iam` for a different IAM, every cross-module FK that pointed at iam's tables breaks every consumer. Soft links keep modules droppable, replaceable, isolated.

### V — Choose data types with precision

| Concern | Required type |
|---|---|
| Identifiers | `text` (cuid2 via `@paralleldrive/cuid2`) |
| Timestamps | `timestamp({ mode: 'date', withTimezone: true })` |
| Money / financial | `numeric` or `bigint` for cents (never `float`/`real`) → **violation** otherwise |
| Booleans | `boolean` (never 0/1 integers) |
| Enums | PostgreSQL `pgEnum` (defined in `enums.ts`) |
| JSON / semi-structured | `jsonb` (never `json` — not indexable) |
| Free text | `text` (not `varchar(N)` unless cap is a real business rule) |

Every entity table uses cuid2 `text` IDs. Auto-increment integers / client-supplied PKs / UUIDv4 → **violation** (composite-PK join tables excepted).

### VI — Index strategically

Required indexes:
- Every column used as JOIN target (within-module FK or cross-module soft link).
- Every column used in WHERE for high-volume reads.
- Every column used in ORDER BY for paginated lists.
- Composite indexes for multi-column query patterns (lead with high-selectivity).
- Partial unique indexes on logical keys with `WHERE deleted_at IS NULL` (§4).

Missing index on a known query target → **concern**. Speculative index without query justification → **concern**.

**Why:** Indexes are both performance multipliers and write taxes. Missing indexes turn 50ms queries into 5-second table scans. Excess indexes turn 5ms writes into 50ms writes (every INSERT/UPDATE updates every index). Index where queries actually hit, not where you think they might.

### VII — Name consistently

- Tables: `{module}_{plural_entities}` (e.g., `identity_principals`).
- Columns: `snake_case` in DB (`text('principal_id')`), camelCase in TypeScript (`principalId`).
- FK columns: `{referenced_entity}_id`, singular.
- Timestamps: `created_at`, `updated_at`, `deleted_at` — exact names.
- Indexes: `idx_{table}_{columns}` non-unique; `uq_{table}_{columns}` unique; `uq_{table}_{columns}_active` partial-unique with soft-delete predicate.

Inconsistent naming → **violation MEDIUM**.

### VIII — Avoid anti-patterns

Forbidden:
- EAV (entity-attribute-value) tables → **violation**. Use `jsonb` with documented shape.
- God Tables (50 columns across unrelated concepts) → **violation**.
- Circular within-module FKs → **violation**.
- Client-generated PKs on entity tables → **violation**.
- Nullable booleans (three-state pretending to be two) → **violation**. Use enum or timestamp.
- `varchar(N)` without a real business rule for N → **concern**.

**Why:** EAV looks flexible but kills query performance (every attribute lookup is a join) and kills the type system (every value is text). God Tables blur boundaries — five concepts in one table means five reasons to change. Nullable booleans hide a third state (`null`) the code never handles correctly; either it's an enum or it's a timestamp ("when was this set"), but it's never `true | false | null` as a feature.

### IX — Manage the data lifecycle

Every entity table has:

```
id text PRIMARY KEY DEFAULT cuid2()
created_at timestamptz NOT NULL DEFAULT now()
updated_at timestamptz NOT NULL DEFAULT now()
deleted_at timestamptz NULL
```

Missing any of these on a new entity table → **violation HIGH**. Join tables (composite PK from two FKs) may omit `id` but still carry `created_at` and `deleted_at`.

### X — Document decisions

Schema files carry comments explaining the *why* of non-obvious decisions (why this type, why soft link vs FK, why this index, why this denormalization). Obvious comments (`// id column`) are noise. Missing rationale on non-obvious decisions → **concern**.

---

## §3 — Soft-delete is mandatory

Every entity table has `deleted_at` nullable timestamp. NULL = active, non-NULL = soft-deleted. (Axiom of Deferred Deletion.)

- Reconciliation Engine physically deletes rows past retention window. Schema designs that prevent this (hard cross-module FKs, missing `deleted_at`) → **violation**.
- Repositories MUST filter `isNull(deletedAt)` on every read (donnie-rules §4). Schema must provide the column.
- Hard `DELETE` from application code → forbidden by axiom. Reconciliation Engine is the sole `DELETE` writer.

**Why:** Hard deletes destroy audit trails (you can't tell what was deleted, by whom, when). They break referential integrity across module boundaries (other modules holding soft links to the deleted ID don't know to clean up). And they make undo impossible — a user who accidentally deletes is out of luck. Soft delete buys all three properties for the cost of one nullable column.

---

## §4 — Partial unique indexes for soft-deletable logical keys

A column with a business uniqueness rule (email, slug, handle) on a soft-deletable entity uses a **partial unique index** with `WHERE deleted_at IS NULL`. Plain `UNIQUE` on such a column → **violation HIGH** (blocks reuse after deletion).

Pattern: a `uniqueIndex(...).on(table.X).where(sql\`${table.deletedAt} IS NULL\`)`. The constraint enforces uniqueness on active rows only; soft-deleted rows are excluded.

Every column with a logical uniqueness rule on a soft-deletable entity must have this. Missing → **violation HIGH**.

---

## §5 — Migrations — zero-downtime, backward-compatible

Schema migrations run against a live database. They must be safe under concurrent application traffic.

Forbidden in a single migration:
- Dropping a column the running app still reads/writes → **violation HIGH**.
- Renaming a column (DROP + ADD; breaks the running app) → **violation HIGH**.
- Type change incompatible with current data (e.g., `text` → `integer`) → **violation HIGH**.
- Adding `NOT NULL` to existing column without default + backfill plan → **violation HIGH**.

Safe pattern for column changes (each step a separate migration):
1. ADD new column (nullable, no constraint).
2. Backfill data (migration or background job).
3. Deploy app that writes both old and new.
4. Deploy app that reads only new.
5. DROP old column.

Multi-step migrations are normal. One-step destructive migrations → **violation HIGH**.

**Why zero-downtime:** Migrations run against a live database while the application serves traffic. A rename is really a DROP + ADD, and between those two steps, the running application has no column to read or write. Splitting into multi-step migrations means at every step the running application is consistent with the schema; nothing breaks mid-deploy.

Generated SQL: produced by `drizzle-kit generate`. Review the SQL; if it's not what you expected, fix the schema and regenerate — never hand-edit the SQL. Hand-edited SQL → **violation**.

**Why never hand-edit:** Hand-edited SQL drifts from the source schema. The next `drizzle-kit generate` will not know your hand-edit happened and will regenerate the "expected" SQL on top of your edit, producing a broken migration history.

Production application: `drizzle-kit migrate` via deploy pipeline. `drizzle-kit push --force` against prod → **violation HIGH** (forbidden by infra-commandments.md §5).

---

## §6 — User-approval gate

Schema changes require explicit user approval before implementation. Archie's output is a Minimal Change Report (template in `.claude/agents/archie.md`), not applied migrations. The orchestrator presents it; the user approves; only then does generation/migration run.

Schema change made without a documented decision in SPEC.md → **process violation** (the auditor flags; the orchestrator owns enforcement).

**Why the gate:** Schema decisions are decisions of record. They ripple through repositories, use cases, and consuming projects. A schema change made silently is a change nobody approved and nobody can reconstruct the rationale for. The approval gate forces the rationale into SPEC.md before the change lands, so the next engineer reading the history knows what was decided and why.

---

## §7 — Drizzle conventions

- Tables: named `pgTable` exports from `{module}/schema/{entity}.ts`, re-exported via `schema/index.ts`.
- Enums: PostgreSQL `pgEnum` in `enums.ts`, not text-with-CHECK.
- Defaults: `$defaultFn(() => createId())` for runtime; `.defaultNow()` for SQL-native.
- Composite PKs: `primaryKey({ columns: [...] })` in the table's second argument.
- JSON columns: `jsonb('column_name').$type<MyType>()` — compile-time shape only; runtime validation in the use case.

Deviation from these idioms → **concern**.

---

## What the auditor checks against this file

When the diff touches files under archie's paths, the auditor reads this file and reasons section-by-section.

Severity:
- HIGH (FAIL): missing `deleted_at` on a new entity table; hard FK across module boundary; missing partial unique index on a business-unique column on a soft-deletable entity; destructive migration in a single step; hand-edited migration SQL not regeneratable; `varchar(255)` for `text`; `float`/`real` for money.
- MEDIUM (WARN): missing index on JOIN target or WHERE column; column type mismatch with §2.V; naming inconsistency (camelCase column, missing module prefix); EAV-shaped table; nullable boolean.
- LOW (note): missing rationale comment on non-obvious decision; speculative index without query justification; minor naming drift.

The card section this file produces: `archie's rules — archie-rules.md`. Findings file-and-line specific, tagged by section/commandment (e.g., `§2.IV` for hard FK across modules; `§4` for missing partial unique index; `§5` for destructive migration).

No softening. False positives are cheaper than false negatives.

---

*Canonical contract for database schema work. Update this file when a new violation pattern emerges; do not invent one-off rules mid-review. Templates, workflow, the Minimal Change Report format, and the user-approval procedure live in `.claude/agents/archie.md`.*
