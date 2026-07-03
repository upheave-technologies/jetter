---
name: infra-seed
description: "Apply, list, author, and verify scenario seeds against a running local stack. Scenarios are reproducible, named, idempotent fixtures (SQL or TypeScript) that establish a known state for development, testing, and AI agent flows. Invoke when the user mentions 'seed', 'scenario', 'fixture', 'test data', 'reset to known state', or 'set up the AI test env'."
---

# /infra-seed — Scenario Seed Operator

You are the steward of `infra/_kit/seeds/` and `apps/<app>/seeds/` (per-project). A **seed scenario** is a named, idempotent transformation that takes "stack is up and migrated" and produces "stack is in a specific known state."

Seeds are how Mario and AI agents converge on the same testbed.

---

## Invocation

| Command | Action |
|---|---|
| `/infra-seed list` | List scenarios available in this project |
| `/infra-seed apply <name>` | Apply a scenario to the running local stack |
| `/infra-seed inspect <name>` | Show what the scenario does without applying it |
| `/infra-seed verify <name>` | Confirm the DB matches the scenario's expected post-state |
| `/infra-seed new <name>` | Scaffold a new scenario file |
| `/infra-seed combine <a> <b> ...` | Apply multiple scenarios in order (idempotent) |
| `/infra-seed reset` | Truncate test data, re-run migrations, re-apply default scenario |

---

## The scenario contract

A scenario lives at `seeds/<name>.{sql,ts,sh}` and **must** include this header:

```sql
-- @scenario: <name>
-- @purpose: <one-line purpose>
-- @idempotent: true              -- mandatory; non-idempotent scenarios are rejected
-- @requires: <other-scenario>    -- optional prerequisite (kit verifies before applying)
-- @produces: <description>       -- what state exists after
-- @verifies:                     -- SQL that returns non-zero rows iff the scenario "took"
--   SELECT 1 FROM <table> WHERE <condition>;
```

For TypeScript:

```ts
// @scenario, @purpose, @idempotent, @requires, @produces, @verifies — same fields, in a leading block comment
export async function apply(db: DatabaseHandle): Promise<void> { ... }
export async function verify(db: DatabaseHandle): Promise<boolean> { ... }
```

For shell:

```bash
# @scenario / @purpose / @idempotent / @requires / @produces / @verifies — same fields in #-prefixed lines
# Receives DATABASE_URL in env. Must exit 0 on success.
```

**The four canonical types of scenario:**

| Type | Naming pattern | Purpose |
|---|---|---|
| **System** | `00-<name>.sql` | Reconcile the world (e.g., projects, default users). Always idempotent. Always safe in prod. |
| **Fixture** | `10-<name>.sql` | Insert reference data (test projects, mock installations, baseline policies). |
| **Scenario** | `20-<name>.sql` | Insert a specific test situation (e.g., "issue labeled, no PR yet"). |
| **Ephemeral** | `99-<name>.sql` | High-churn AI-test inputs; truncated by `reset`. |

Numerical prefixes drive default apply order when the user says `apply all`.

---

## Apply protocol

```bash
infra/_kit/bin/stack seed <name>
```

Internally:
1. Stack health check (`stack ps` confirms the stack is up).
2. Read scenario header; refuse if `@idempotent: false`.
3. Apply scenario inside a transaction (SQL) or via the scenario runner (TS/sh).
4. Run `@verifies` block; if it returns no rows / false, **fail loudly**.
5. Log to `~/.stack/seed-log.jsonl` (timestamp, project, worktree, scenario, verdict).
6. Print the post-state summary.

If the scenario is being run a second time, the verifier should still pass — that's idempotency.

---

## Authoring a new scenario

```bash
infra/_kit/bin/stack seed new <name>
```

The kit scaffolds `seeds/<name>.sql` with the mandatory header pre-filled. Your job:

1. **Pick a verifier first.** What single SQL query proves the scenario took? Write that before the body. If you can't write it, your scenario isn't testable.
2. **Use idempotent constructs.** `INSERT ... ON CONFLICT (id) DO UPDATE SET ...`, or `INSERT ... WHERE NOT EXISTS (...)`. Never bare `INSERT`.
3. **Reference fixtures explicitly.** If scenario `20-issue-labeled` depends on `10-default-projects`, declare it in `@requires`.
4. **Keep it surgical.** A scenario sets up a state, not a story. If the test requires three states in sequence, that's three scenarios applied in order, not one giant blob.

---

## Reading scenarios for AI

When an agent invokes `/infra-seed apply <name>` as part of a larger flow, the agent **must**:

1. Read the scenario header before applying — this is the contract the test will rely on.
2. Confirm the seed targets a **sandbox** (or that the user has authorized seeding into the primary). For AI workflows the right pattern is: `ID=$(stack sandbox create --quiet)` → `stack sandbox $ID seed apply <name>`. Seeding into the primary modifies the human's interactive dev DB and should require explicit consent.
3. Apply.
4. Verify.
5. Capture the seed verdict in the run log alongside test results.

Skipping any step makes the test result meaningless because the input state is unknown.

---

## Combining scenarios

```bash
infra/_kit/bin/stack seed combine 10-default-projects 20-issue-labeled 99-pr-already-open
```

Applied in the order given. Each must individually satisfy `@idempotent: true`. If one fails the verifier, the kit stops and reports — does not "best effort" through the remaining.

---

## Reset

```bash
infra/_kit/bin/stack seed reset
```

This is **not** `stack reset`. It:
1. Truncates every table tagged in `seeds/_reset.sql` (a project-maintained list — usually anything in the ephemeral domain).
2. Re-runs migrations.
3. Re-applies all `00-*` and `10-*` scenarios (system + fixture).

Useful when an AI flow has left the DB in a known-mess state but you don't want to drop the volume.

---

## What this skill is NOT

- ❌ Not a test runner. It sets up the input; the test runs separately.
- ❌ Not a migration tool. Migrations are owned by `drizzle-kit` / the project's ORM CLI.
- ❌ Not allowed in production. There is no `--target prod`. If you find yourself reaching for it, you want a backfill script in the application, not a seed.

---

## Self-check

- [ ] Did I read the scenario's `@verifies` block before applying?
- [ ] Is the stack ephemeral, or did the user explicitly authorize seeding a long-running stack?
- [ ] Did the verifier pass post-apply?
- [ ] Did I log the seed run?
