// =============================================================================
// scripts/migrate-deploy.mjs — the production deploy migration runner
// =============================================================================
// Applies BOTH of jet's independent drizzle-kit migration sets, in order,
// fail-closed, against whatever database DATABASE_URL points at.
//
//   set 1 (bookings) : drizzle.config.ts        → modules/bookings/schema/migrations
//   set 2 (audit)    : drizzle.audit.config.ts  → modules/audit/schema/migrations
//
// WHY THIS SCRIPT EXISTS
// ----------------------
// jet has two schema modules, each with its own self-contained drizzle-kit
// migration journal (drizzle-kit tracks applied migrations per-`out`-dir; a
// single Config has exactly one `out`, so two modules require two configs — see
// the header of drizzle.audit.config.ts). Every production deploy must apply
// BOTH, or the running app boots against a half-migrated schema. Wrapping the
// two `drizzle-kit migrate` invocations in one script makes "both sets, in a
// sensible order, abort-on-failure" a single repo-owned, reusable contract:
//   - CI calls it as one gating step (see .github/workflows/deploy.yml).
//   - A human can call it for a one-off manual deploy (pnpm db:migrate:deploy).
//   - It behaves identically in both.
//
// IDEMPOTENCY (infra-commandments §6)
// -----------------------------------
// This script adds NO state of its own. Idempotency is inherited entirely from
// `drizzle-kit migrate`, which reads each journal's `__drizzle_migrations`
// bookkeeping table and applies only migrations not yet recorded. Re-running a
// deploy with no new migration files is therefore a no-op for both sets. Do not
// add "have we run this before?" logic here — that would duplicate (and risk
// contradicting) drizzle-kit's own tracking.
//
// FAIL-CLOSED (infra-commandments §7 code pipeline; blast-radius contract)
// ------------------------------------------------------------------------
// The sets run sequentially. If set 1 exits non-zero, set 2 never runs and the
// script exits non-zero. If set 2 exits non-zero, the script exits non-zero.
// In CI, a non-zero exit here aborts the pipeline BEFORE the app is deployed —
// the app is never promoted onto a half-migrated database. A data-incompatible
// migration (e.g. a CHECK-constraint tightening that existing rows violate)
// will fail here, which is correct: it blocks the deploy until the data is
// reconciled, rather than shipping an app that 500s on the bad rows.
//
// ORDER
// -----
// bookings first, then audit. The two modules share one Postgres database (one
// DATABASE_URL) but define no cross-module objects, so their DDL is
// order-INDEPENDENT (per drizzle.audit.config.ts's own note). A fixed order is
// still chosen for determinism and readable logs; it is not a dependency.
//
// SECRETS / TWO-PIPELINES RULE (infra-commandments §7)
// ----------------------------------------------------
// This is the CODE/DEPLOY pipeline. It introduces NO new secret handling: it
// reads the SAME DATABASE_URL the application already needs. In CI that value is
// the Neon DIRECT (non-pooled) connection string, supplied as a repo secret and
// injected only into this step's env. This script never reads, writes, prints,
// or transmits the value — it hands the process-inherited env straight to
// drizzle-kit. Never echo DATABASE_URL from here.
//
// USAGE
//   DATABASE_URL="postgres://…direct-host…/db?sslmode=require" \
//     node scripts/migrate-deploy.mjs
//   # or, via package.json:
//   DATABASE_URL="…" pnpm db:migrate:deploy
//
// For Neon, use the DIRECT (non-pooled, no `-pooler` subdomain) URL: pgbouncer's
// transaction pooling interferes with the multi-statement migration session.
// The RUNNING APP uses the pooled URL; MIGRATIONS use the direct URL. (See
// infra/README.md → "Production: Neon" §3.)
// =============================================================================

import { spawnSync } from 'node:child_process';

/** The two migration sets, applied in this order. */
const MIGRATION_SETS = [
  { name: 'bookings', config: 'drizzle.config.ts' },
  { name: 'audit', config: 'drizzle.audit.config.ts' },
];

// Fail-closed pre-flight: refuse to run without a target. drizzle-kit would
// error anyway, but a clear message here beats a stack trace, and it prevents a
// silent "migrated nothing" if DATABASE_URL is empty in some environments.
if (!process.env.DATABASE_URL || process.env.DATABASE_URL.trim() === '') {
  console.error(
    '[migrate-deploy] FATAL: DATABASE_URL is not set. Migrations need the ' +
      'database connection string (the Neon DIRECT url in production). Aborting ' +
      'before touching either migration set.',
  );
  process.exit(1);
}

console.log('[migrate-deploy] applying 2 migration set(s), fail-closed…');

for (const set of MIGRATION_SETS) {
  console.log(`[migrate-deploy] → set "${set.name}" (${set.config})`);

  // Inherit stdio so drizzle-kit's own per-migration output streams to the CI
  // log. Inherit env so DATABASE_URL flows through WITHOUT this script ever
  // reading its value. `drizzle-kit` is resolved from node_modules/.bin via the
  // package manager that invokes this script (pnpm/npx); we call it through the
  // local binary shim to avoid depending on a global install.
  const result = spawnSync(
    'pnpm',
    ['exec', 'drizzle-kit', 'migrate', `--config=${set.config}`],
    { stdio: 'inherit', env: process.env },
  );

  if (result.error) {
    console.error(
      `[migrate-deploy] FATAL: could not launch drizzle-kit for set "${set.name}": ${result.error.message}`,
    );
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(
      `[migrate-deploy] FATAL: set "${set.name}" migration FAILED (exit ${result.status}). ` +
        'Aborting: remaining sets are NOT applied and the deploy must NOT proceed. ' +
        'The database is left with whatever this set committed before failing ' +
        '(each migration is atomic in its own transaction); investigate before retrying.',
    );
    process.exit(result.status ?? 1);
  }

  console.log(`[migrate-deploy] ✓ set "${set.name}" up to date.`);
}

console.log('[migrate-deploy] ✓ all migration sets applied successfully.');
