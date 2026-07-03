# Stack Seeds — Scenario Authoring

Seeds are **named, idempotent transformations** that take "stack is up and migrated" and produce "stack is in a specific, known state." They are how developers and AI agents converge on the same testbed.

A seed is a single file under this directory:

```
infra/_kit/seeds/
├── _reset.sql                  # special — TRUNCATEs run by `stack seed reset`
├── 00-defaults.sql             # system seeds: idempotent reconcilers
├── 10-projects-baseline.sql    # fixture seeds: reference data
├── 20-issue-labeled.sql        # scenario seeds: specific situations
├── 20-pr-already-open.sql      # ...
└── 99-flood.ts                 # ephemeral seeds: high-churn AI inputs
```

Numerical prefixes drive default apply order when the user says "apply all" — system → fixture → scenario → ephemeral.

## The contract every seed file must honor

Every seed file starts with this header block. The runner refuses to apply a file that doesn't declare `@idempotent: true`.

```sql
-- @scenario:   <unique-name>
-- @purpose:    one-line description of what this seed does
-- @idempotent: true
-- @requires:   <other-scenario>          (optional — runner verifies the prereq ran)
-- @produces:   description of post-state (free-form)
-- @verifies:
--   SELECT count(*) FROM <table> WHERE <condition>;
```

`@verifies` is the SQL the runner executes after apply. If it returns no rows / 0 / false, the seed is treated as "did not take."

For TypeScript / shell seeds, the header lives in a leading block-comment with the same fields.

## Idempotent constructs

The runner does **not** wrap your seed in extra magic — your SQL itself must be safely re-runnable.

```sql
-- ✅ Idempotent insert
INSERT INTO projects (id, slug, name, status)
VALUES ('p_test', 'test-repo', 'Test Repo', 'active')
ON CONFLICT (id) DO UPDATE SET
  slug = EXCLUDED.slug,
  name = EXCLUDED.name,
  status = EXCLUDED.status;

-- ✅ Idempotent update
UPDATE projects SET status = 'archived' WHERE slug = 'old-repo';

-- ❌ Not idempotent (will fail on second run)
INSERT INTO projects (id, slug, name, status) VALUES (...);
```

If your scenario must clear and reset a small region of the DB before inserting (because you're modeling "the system at a specific snapshot"), do this:

```sql
BEGIN;
DELETE FROM signals WHERE source = 'test-fixture';
DELETE FROM projects WHERE slug LIKE 'test-%';
-- then insert the canonical fixture state
INSERT INTO projects (...) VALUES (...);
COMMIT;
```

## TypeScript seeds

For scenarios that need rich logic (computing IDs, calling functions, generating data), write a `.ts` file:

```ts
// @scenario: 20-many-projects
// @purpose: insert N test projects with derived slugs
// @idempotent: true
// @verifies:
//   SELECT count(*) FROM projects WHERE slug LIKE 'gen-%';

import { Client } from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL not set');

const client = new Client({ connectionString: url });
await client.connect();
try {
  for (let i = 1; i <= 50; i++) {
    const slug = `gen-${i.toString().padStart(3, '0')}`;
    await client.query(
      `INSERT INTO projects (id, slug, name, status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (slug) DO NOTHING`,
      [`p_gen_${i}`, slug, `Generated ${i}`]
    );
  }
} finally {
  await client.end();
}
```

The runner sets `DATABASE_URL` from the worktree's allocated DB port and invokes via `pnpm exec tsx`.

## Shell seeds

For scenarios that need to call external commands (e.g., create a Slack channel, register a GitHub installation), use a `.sh` file:

```bash
#!/usr/bin/env bash
# @scenario: 20-github-installation
# @purpose: register a fake GitHub installation row + matching credential
# @idempotent: true
# @verifies:
#   SELECT 1 FROM credentials WHERE provider = 'github' AND provider_account_id = '12345';

set -euo pipefail

psql "$DATABASE_URL" <<SQL
INSERT INTO credentials (id, type, provider, provider_account_id, secret_hash, key_prefix)
VALUES ('c_test_gh', 'oauth', 'github', '12345', 'dummy', 'fake')
ON CONFLICT (id) DO NOTHING;
SQL
```

The runner sets `DATABASE_URL` and runs `bash <file>`.

## The reset file

`_reset.sql` is a special file the kit applies during `stack seed reset`. It typically truncates ephemeral and scenario tables (NOT system/fixture tables) so the DB returns to a "baseline + nothing else" state:

```sql
-- @scenario: _reset
-- @purpose: truncate ephemeral / scenario tables for a clean re-seed
-- @idempotent: true
-- @verifies: SELECT 1;

TRUNCATE signals, sessions, dispatch_logs, notifications, messages RESTART IDENTITY CASCADE;
```

After truncation, `stack seed reset` re-applies all `00-*` and `10-*` seeds automatically.

## Authoring workflow

```bash
# 1. Scaffold
stack seed new 20-my-scenario

# 2. Open the file the kit just created at infra/_kit/seeds/20-my-scenario.sql
#    Fill in @purpose, @produces, @verifies, and the body.

# 3. Test it
stack up                          # ensure stack is running
stack seed apply 20-my-scenario   # apply
stack seed apply 20-my-scenario   # apply again — must succeed (idempotent)

# 4. Inspect produced state
stack psql -c 'SELECT * FROM <whatever-you-touched>'
```

## What seeds are NOT for

- ❌ **Migrations.** Schema changes belong in `drizzle-kit` (or your project's ORM). Seeds operate on existing tables.
- ❌ **Production.** There is no `--target prod` flag. If you need to backfill prod data, write a one-off script in `apps/<app>/scripts/` and invoke it through the deploy pipeline.
- ❌ **Side effects beyond the DB.** Seeds shouldn't send Slack messages, create GitHub PRs, or call external APIs. Mock those side effects in scenario tables (e.g., write to a `mock_dispatch_log` table) so the application can verify without burning real quota.

## Naming convention

| Prefix | Type | Purpose | Touched by `seed reset`? |
|---|---|---|---|
| `00-` | System | Idempotent reconcilers (default projects, default roles, etc.) | Re-applied |
| `10-` | Fixture | Reference data (test projects, baseline policies) | Re-applied |
| `20-` | Scenario | Specific test situations | Not re-applied; manual |
| `99-` | Ephemeral | High-churn AI test inputs | Truncated then not re-applied |
| `_reset.sql` | Special | The TRUNCATE list | Always |

The kit reads the prefix from the filename, not from the `@scenario` field.
