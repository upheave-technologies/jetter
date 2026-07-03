---
description: "Donnie's backend-specific contract — repository discipline, idempotency, code-shape commandments, capability sidecars, authorization gates. Read by donnie when producing code, read by the auditor when verifying backend work."
paths:
  - "modules/**/domain/**"
  - "modules/**/application/**"
  - "modules/**/infrastructure/**"
  - "packages/@core/*/domain/**"
  - "packages/@core/*/application/**"
  - "packages/@core/*/infrastructure/**"
---

# Donnie's Rules

Donnie-specific backend rules. The cross-cutting layer rules (R1–R9, layer cake, module isolation, public API, one-use-case-per-file, no service classes) live in `ddd-architecture.md` and load automatically when these paths match. The engineering mindsets (Result types, idempotency, pure core, security) live in `architecture.md`.

This file is the **backend specialization** of those rules — what donnie must do beyond the cross-cutting contract.

## Scope

Donnie owns: backend code in `modules/{name}/{domain,application,infrastructure}/**` and `packages/@core/{name}/{domain,application,infrastructure}/**`.

Out of scope: `app/**` (nexus/frankie), `**/_components|_containers/**` (frankie), `**/page.tsx|layout.tsx|actions.ts|route.ts` (nexus/frankie), `**/schema/**` (archie).

---

## §1 — Domain layer purity (beyond ddd-architecture)

The domain is pure. Functions return `Result<T, E>` (per `architecture.md` §5); they never throw across the boundary.

Forbidden in domain files:
- `await` calls — domain functions are synchronous over plain values.
- `Date.now()`, `crypto.randomUUID()` — pass them in as parameters instead.
- `console.log` — domain has no side effects, including logging.

**Why:** Pure domain functions are testable without infrastructure, fakes, or mocks. They run identically in every environment. The moment a domain function reads the clock or generates an ID, it's coupled to a runtime, and tests become flaky.

---

## §2 — Repository discipline

The infrastructure layer is the only layer that touches external services. Repositories enforce data integrity at the read/write boundary.

**Required on every repository:**
- One repository per domain entity. Two entities means two repositories.
- Factory function shape: `make{Entity}Repository(db): IEntityRepository`. Returns the domain interface.
- **Soft-delete filter on every read.** Every `SELECT` / `findFirst` / `findMany` / `findById` / `findBy*` includes `isNull(deletedAt)` or equivalent.
  - **Why:** A single missed filter leaks deleted records into application state. Bugs surface in production when a "deleted" user appears in a list. The architecture-guard hook flags repositories missing this; the auditor flags it as a concern.
- **Hard delete is forbidden.** `softDelete(id)` sets `deletedAt = now()`. Physical deletion is the reconciliation engine's job.
  - **Why:** Hard deletes destroy audit trails and break referential integrity across module boundaries. The Axiom of Deferred Deletion (in `architecture.md`) demands this.

**Query discipline:**
- **Unbounded queries are forbidden.** Every `findMany` / `findAll` has a hard `LIMIT` or is replaced by a paginated variant (`findPage`, `findCursor`).
  - **Why:** Today's "small table" is tomorrow's million-row table. Unbounded queries are landmines.
- **N+1 patterns** — repository call inside a loop where a batch variant exists → **concern**.
- **Multi-step writes use transactions.** Repository methods accept a tx handle, or use case composes inside `db.transaction(...)`. Half-applied writes are bugs.
- **Cross-module reads use soft links.** A module's repository never queries another module's tables directly. Cross-module needs go through that module's public-API use cases. (See `ddd-architecture.md` §2.)

---

## §3 — Use case authorization gating

Use cases that mutate or read protected data receive a `Principal` (or evaluated `Ability`) and enforce the policy as their **first step** — before any other work.

**Why:** Authorization is not a route-level concern; it is a use case concern. The route is a coarse gate; the use case is the policy enforcement. Both are required. Skipping the use-case-level check creates a back door: any future caller (a CLI, a worker, a different route) gets to bypass the policy unless the use case catches it.

```typescript
export const makeCreateEntityUseCase = (
  entityRepository: IEntityRepository
) => {
  return async (input: { principal: Principal; data: CreateEntityInput }) => {
    // 1. Authorization FIRST
    if (!input.principal.ability.can('create', 'Entity')) {
      return { success: false, error: new ModuleError('Forbidden', 'FORBIDDEN') };
    }
    // 2. ...rest of orchestration
  };
};
```

Use cases that mutate without an authorization check → **violation HIGH**.

---

## §4 — Idempotency on retriable handlers

Per `architecture.md` §6 (the mindset): any code path invoked by a webhook, queue consumer, scheduled job, or other retriable trigger MUST be idempotent.

The mechanical rule donnie enforces:

For each use case reachable from a webhook / queue / scheduler AND creating persistent side effects (DB inserts, message sends, queue enqueues, external API calls with effect), verify ONE of:
- A uniqueness lookup by natural key (e.g., `signalId + modeId`) before the side effect, OR
- A unique constraint at the schema level on that natural key (archie-rules §4 — partial unique index).

Neither present → **violation HIGH**.

**Why:** The cost of idempotency is one uniqueness check. The cost of duplicate side effects (double payments, double notifications, duplicate PRs) is often impossible to reverse and always damaging.

---

## §5 — Error handling — module error class

Each module exports a single error class:

```typescript
// {module}/application/{module}Error.ts
export class ModuleError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'ModuleError';
  }
}
```

Required:
- Module error classes extend `Error`, live in `application/{module}Error.ts`, carry a `code: string`.
- When mapping infrastructure errors to module errors, strip ORM-specific details. The use case returns a domain-level error, not a raw ORM string like `"duplicate key violation on idx_principal_email_unique"`.
  - **Why:** Leaking ORM details couples your callers to your storage layer. The day you swap ORMs, every consumer must change. Mapping at the boundary keeps the public API stable.
- Empty `catch` blocks → **violation**. Either log + transform to a Result, or rethrow.

---

## §6 — Code shape — eleven commandments

Shape rules that apply to backend use case files. Earned from real violations. The auditor reads every changed `*UseCase.ts` in full and applies these.

### §6.1 — Policy lives in pure functions. The shell only executes. **HIGH**

Conditional branches inside an async function body that construct domain types inline (`{ outcome: ..., trustLevel: ..., reason: ... }`) or encode domain rules belong in pure functions in `domain/`. The use case shell calls them and dispatches on the result.

**Why:** Policy embedded in the imperative shell is policy that cannot be tested without infrastructure, cannot be reused across use cases, and rots when the shell rots. Extracting it to a pure function makes it portable, testable, and reusable.

### §6.2 — Phase boundaries are value types, not comments. **MEDIUM**

Three or more `// Step N` / `// Phase` comments where the data flowing between phases is local variables → violation. Reify each phase as a named type.

**Why:** Comments are not the type system. A phase boundary that exists only as a comment doesn't exist to the compiler, the tests, or the audit log. Reifying phases as types makes the seams explicit.

### §6.3 — A use case has one role; its deps reflect that role. **MEDIUM**

`Deps` type with more than ~8 functions across more than ~5 conceptual roles → violation. Regroup into role-named ports (`SignalReader`, `Dispatcher`, `AuditWriter`).

**Why:** A 14-function deps bag is a god-function in disguise. Role-segregated deps make Interface Segregation explicit — each port has one reason to change.

### §6.4 — Cross bounded contexts only through ports. **HIGH**

Import line matching `../../<other-module>/infrastructure/...` from `modules/X/application/` → violation. Define a port in `modules/X/application/ports/` and an adapter in `modules/X/infrastructure/adapters/` that wraps the other module's public surface.

**Why:** Direct cross-module imports of internals erode bounded contexts. The day module B refactors its internal types, every consumer in module A breaks. Ports are the firewall.

### §6.5 — Don't duplicate behavior another use case already provides. **HIGH**

Multi-step orchestration (write + notify + audit) that matches a peer use case's behavior → violation. Call the peer use case instead.

**Why:** Two copies of the same orchestration drift. One gets a fix, the other doesn't. Calling the canonical use case keeps behavior consistent across callers.

Caveat: if message/channel-fallback semantics differ, the block may be a legitimate feature variant, not duplication.

### §6.6 — Discriminated unions exit through one place. **MEDIUM**

Switch arms over a union's `kind` / `type` field with >5 lines of inline orchestration AND domain-type construction AND side effects → violation. Extract a pure `interpret<Thing>(output, ctx): <Directive>`; switch becomes one-line-per-arm dispatch.

**Why:** Adding a fifth union case shouldn't require editing the producer, the validator, AND every consumer. If interpretation lives in a pure function and consumers dispatch on the directive, Open/Closed holds.

### §6.7 — The shell shall not be longer than the core. **MEDIUM**

`useCaseLines / max(1, domainLines) > 3.0` AND the body contains conditional logic constructing domain types → violation.

**Why:** A use case shell five times larger than the domain it orchestrates has absorbed the policy it was supposed to delegate. Extract decision logic to `domain/`.

### §6.8 — No construct-then-mutate. **LOW**

`const x = builder(...)` followed within 20 lines by `x.field = ...` and `x` used after → violation.

**Why:** The mutation is a confession that the builder's signature is wrong. Extend the builder; don't paper over with patches.

### §6.9 — No string-typed magic values. **MEDIUM**

A string-typed field with fewer than ~10 distinct literals AND a fallback ("unknown", "default", "none", "") not in the real set → violation. Encode as a union type.

**Why:** Free-form strings escape the type system. The day a typo appears, it compiles. A union type makes invalid values a compile error.

### §6.10 — Fire-and-forget without idempotency is a bug. **HIGH**

(Same rule as §4; restated at file level for the auditor's per-file walk.)

### §6.11 — No dead code in shipped work. **HIGH**

A `tsc --noUnusedLocals --noUnusedParameters` hit on a modified file (TS6133 / TS6196), OR an exported symbol with zero in-repo imports, OR an unused parameter not prefixed with `_` → violation. The `build-check.sh` Stop hook enforces this mechanically; the auditor cross-checks for orphan exports and stale block-comment headers.

**Why:** Dead code is one of three things — a missed cleanup (author didn't finish), load-bearing code the author wrongly thinks is unused (a bug masquerading as cleanup), or speculative scaffolding (maintenance cost shifted to every reader for a hypothetical). All three are bad.

---

## §7 — Capability sidecars

Every `*UseCase.ts` file MUST have a co-located `*UseCase.capability.ts` sidecar declaring `preconditions` and `effects`. Missing sidecar → **violation** (architecture-guard blocks at write time).

**Why:** Capability sidecars feed the scenario prover — they make explicit what the use case requires and produces, enabling automated scenario verification. Without sidecars, the prover can't verify that a multi-step flow's preconditions and effects compose correctly.

Query-only use cases set `query: true, effects: []`. New modules also register capability names in `packages/shared/prover/capabilities.ts` and effect tokens in `packages/shared/prover/effects.ts`. `build-check.sh` runs `pnpm scenarios:generate:check` and blocks on capability drift.

---

## §8 — Observability in repositories

Structured logs at repository boundaries:
- Long-running queries, retries, and external API calls emit a structured event (`{ event, durationMs, ... }`) — never raw string `console.log`.
- Per `architecture.md` §2: values whose names contain `password`, `token`, `secret`, `key`, `credential` MUST NOT appear in any log line by value → **violation HIGH**.
- Use cases spanning multiple repository calls emit one structured event at entry and one at exit, carrying a correlation ID.

**Why:** Production debugging is one grep away when logs are structured events. With raw strings, it's a needle in a haystack.

---

## What the auditor checks against this file

When the diff touches files under donnie's paths, the auditor reads this file (and `ddd-architecture.md`, and `architecture.md`) and reasons section-by-section. Severity:

- HIGH (FAIL): missing soft-delete filter; hard `DELETE` in repository; missing authorization in mutating use case; missing idempotency on retriable handler; secret leakage in logs; missing capability sidecar; HIGH-severity commandment violation (§6.1, §6.4, §6.5, §6.10, §6.11).
- MEDIUM (WARN): missing soft-delete filter on read query (sometimes a concern, sometimes a violation depending on context); medium-severity commandments (§6.2, §6.3, §6.6, §6.7, §6.9); N+1 patterns; unbounded queries.
- LOW (note): low-severity commandments (§6.8); minor observations.

Card section: `donnie's rules — donnie-rules.md`. Findings tagged by section (e.g., `§2 missing soft-delete filter`, `§6.4 cross-context import`, `§7 missing sidecar`).

No softening. False positives are cheaper than false negatives.

---

*Backend-specific rules. Cross-cutting layer rules live in `ddd-architecture.md`; engineering mindsets live in `architecture.md`. Code templates, workflow, discovery procedures live in `.claude/agents/donnie.md`.*
