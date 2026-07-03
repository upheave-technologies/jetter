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
// reads the SAME database this app already needs, via one of two env vars:
//   - NEON_DIRECT_DATABASE_URL — preferred. The Neon DIRECT (non-pooled) url.
//   - DATABASE_URL             — fallback, for manual/one-off invocations.
// Whichever is chosen is placed into DATABASE_URL for the child drizzle-kit
// processes ONLY (env is per-process). This never mutates Vercel's runtime env,
// where DATABASE_URL is the POOLED url the app uses. This script never reads,
// writes, prints, or transmits the value — it hands the child env to
// drizzle-kit. Never echo the connection string from here.
//
// WHY A SEPARATE DIRECT VAR ON VERCEL
//   The running app's DATABASE_URL on Vercel is the POOLED (`-pooler`) url —
//   correct for many short serverless connections. But drizzle-kit migrate
//   opens a long multi-statement session, and pgbouncer TRANSACTION pooling
//   breaks/hangs it. So migrations MUST use the DIRECT (non-`-pooler`) url. We
//   read it from a distinct build-only var (NEON_DIRECT_DATABASE_URL) rather
//   than overwriting the app's pooled DATABASE_URL. (See infra/README.md §3.)
//
// PRODUCTION-ONLY (Vercel builds)
//   When invoked inside a Vercel build (VERCEL === '1'), migrations run ONLY on
//   PRODUCTION deploys (VERCEL_ENV === 'production'). Preview/development builds
//   SKIP — there is no per-preview branch DB to target (the Neon-branch-per-PR
//   automation lived in the now-disabled GitHub Actions workflow), so a preview
//   build must NEVER migrate the production database. Outside a Vercel build
//   (VERCEL unset — local / CI / manual), the guard does not apply and
//   migrations run as before.
//
// USAGE
//   # Manual one-off (guard does not apply — VERCEL is unset):
//   DATABASE_URL="postgres://…direct-host…/db?sslmode=require" \
//     node scripts/migrate-deploy.mjs
//   # or, via package.json:
//   DATABASE_URL="…" pnpm db:migrate:deploy
//   # On Vercel: `vercel-build` runs this first; it reads NEON_DIRECT_DATABASE_URL
//   # (set as a Vercel PRODUCTION env var, non-pooled) and migrates iff
//   # VERCEL_ENV === 'production'.
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

// Hard upper bound per drizzle-kit migrate child (ms). A stall — a misconfigured
// direct url, a network black hole, a wedged pgbouncer session — should fail
// fast with a clear, set-named message rather than hang until Vercel's outer
// build timeout kills the whole build with no attribution. 120s is generous for
// applying the small, additive migrations this repo ships while still bounding a
// true hang. On timeout spawnSync kills the child; we treat that as failure
// (fail-closed), same as any non-zero exit.
const MIGRATE_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// PRODUCTION-ONLY GUARD (Vercel builds only)
// ---------------------------------------------------------------------------
// Vercel sets VERCEL=1 on every build and VERCEL_ENV to one of
// production | preview | development. We migrate iff this is a Vercel build AND
// the target is production. Any other Vercel build (preview/development, or an
// unexpected/absent VERCEL_ENV) SKIPS migrations and returns success so the
// build proceeds — we never migrate the prod DB from a non-production build,
// and there is no per-preview branch DB to migrate. Outside a Vercel build
// (VERCEL unset), the guard is a no-op: manual/CI runs migrate as before.
//
// `isVercelProdBuild` is remembered for the connection-target block below: on a
// Vercel PRODUCTION build the DIRECT url is MANDATORY (a missing one is fatal,
// never a silent fall-back to the pooled url that drizzle-kit migrate can't use).
let isVercelProdBuild = false;
if (process.env.VERCEL === '1') {
  const vercelEnv = process.env.VERCEL_ENV ?? '(unset)';
  if (vercelEnv !== 'production') {
    console.log(
      `[migrate-deploy] SKIP: Vercel build with VERCEL_ENV=${vercelEnv} ` +
        '(not "production"). Migrations run on PRODUCTION deploys only — a ' +
        'preview/development build has no branch DB to target and must not ' +
        'migrate the production database. Proceeding to the build.',
    );
    process.exit(0);
  }
  isVercelProdBuild = true;
  console.log(
    '[migrate-deploy] Vercel PRODUCTION build detected — migrations will run.',
  );
}

// ---------------------------------------------------------------------------
// CONNECTION TARGET: prefer the DIRECT url, fall back to DATABASE_URL
// ---------------------------------------------------------------------------
// drizzle.config.ts and drizzle.audit.config.ts both read process.env.DATABASE_URL.
// On Vercel, DATABASE_URL is the POOLED runtime url (wrong for migrations), so we
// prefer NEON_DIRECT_DATABASE_URL and inject it as DATABASE_URL for the child
// drizzle-kit processes only. Manual/CI runs that set only DATABASE_URL keep
// working unchanged. The value is never logged.
const directUrl = process.env.NEON_DIRECT_DATABASE_URL;
const hasDirectUrl = Boolean(directUrl && directUrl.trim() !== '');

// On a Vercel PRODUCTION build the DIRECT url is MANDATORY. The app's runtime
// DATABASE_URL on Vercel is the POOLED (`-pooler`) url, and drizzle-kit migrate
// opens a long multi-statement session that pgbouncer TRANSACTION pooling
// hangs/breaks — so silently falling back to the pooled DATABASE_URL here would
// defeat the whole direct-url design and stall the build. Refuse fail-closed
// instead. (Never log either url value — architecture.md §2.)
if (isVercelProdBuild && !hasDirectUrl) {
  console.error(
    '[migrate-deploy] FATAL: Refusing to migrate production: ' +
      'NEON_DIRECT_DATABASE_URL is not set. The pooled DATABASE_URL cannot be ' +
      'used for drizzle-kit migrate (pgbouncer transaction pooling breaks the ' +
      'multi-statement migration session) — set the Neon DIRECT (non-pooled) ' +
      'url as a Vercel Production env var (see infra/README.md §3a). ' +
      'Aborting before touching either migration set.',
  );
  process.exit(1);
}

if (hasDirectUrl) {
  process.env.DATABASE_URL = directUrl;
  console.log(
    '[migrate-deploy] using NEON_DIRECT_DATABASE_URL (direct, non-pooled) for migrations.',
  );
}

// Fail-closed pre-flight: refuse to run without a target. drizzle-kit would
// error anyway, but a clear message here beats a stack trace, and it prevents a
// silent "migrated nothing" if the connection string is empty in some
// environments. (On a Vercel production build this is already unreachable — the
// mandatory-direct-url check above exits first — but it stays as the general
// guard for manual/CI runs and non-production paths.)
if (!process.env.DATABASE_URL || process.env.DATABASE_URL.trim() === '') {
  console.error(
    '[migrate-deploy] FATAL: no database connection string. Set ' +
      'NEON_DIRECT_DATABASE_URL (preferred, the Neon DIRECT url) or DATABASE_URL. ' +
      'Aborting before touching either migration set.',
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
  // local binary shim to avoid depending on a global install. `timeout` bounds a
  // stall so it fails fast (fail-closed) instead of hanging to the outer build
  // timeout — on expiry spawnSync SIGTERMs the child and returns with
  // result.signal set and result.status === null.
  const result = spawnSync(
    'pnpm',
    ['exec', 'drizzle-kit', 'migrate', `--config=${set.config}`],
    { stdio: 'inherit', env: process.env, timeout: MIGRATE_TIMEOUT_MS },
  );

  // Timeout is fail-closed. spawnSync signals a timeout by killing the child:
  // result.error is an ETIMEDOUT Error and/or result.signal names the kill
  // signal (and status is null). Handle it explicitly so the message names the
  // failing set and the bound, rather than surfacing as a generic launch error.
  const timedOut =
    result.error?.code === 'ETIMEDOUT' || result.signal != null;
  if (timedOut) {
    console.error(
      `[migrate-deploy] FATAL: set "${set.name}" (${set.config}) migration ` +
        `TIMED OUT after ${MIGRATE_TIMEOUT_MS} ms and was killed. ` +
        'A stall usually means a bad/unreachable connection target (e.g. a ' +
        'pooled url that pgbouncer transaction pooling hangs, a wrong host, or ' +
        'a network black hole). Aborting fail-closed: remaining sets are NOT ' +
        'applied and the deploy must NOT proceed.',
    );
    process.exit(1);
  }

  // Any other launch failure (binary missing, spawn error) — fail-closed.
  if (result.error) {
    console.error(
      `[migrate-deploy] FATAL: could not launch drizzle-kit for set "${set.name}": ${result.error.message}`,
    );
    process.exit(1);
  }

  // status === null with no timeout/signal is an unexpected killed/unknown
  // outcome — treat as failure (never as success).
  if (result.status !== 0) {
    const partialFailureNote =
      MIGRATION_SETS[0].name === set.name
        ? ''
        : 'Re-run is safe (drizzle-kit skips already-applied migrations); ' +
          'investigate the failing set before retrying — see /infra-cloud-triage. ';
    console.error(
      `[migrate-deploy] FATAL: set "${set.name}" migration FAILED (exit ${result.status}). ` +
        'Aborting: remaining sets are NOT applied and the deploy must NOT proceed. ' +
        'The database is left with whatever this set committed before failing ' +
        '(each migration is atomic in its own transaction); investigate before retrying. ' +
        partialFailureNote,
    );
    process.exit(result.status ?? 1);
  }

  console.log(`[migrate-deploy] ✓ set "${set.name}" up to date.`);
}

console.log('[migrate-deploy] ✓ all migration sets applied successfully.');
