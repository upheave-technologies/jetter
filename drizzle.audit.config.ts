// =============================================================================
// Drizzle Kit configuration — AUDIT MODULE
// =============================================================================
// WHY A SEPARATE CONFIG FILE (and not an edit to ./drizzle.config.ts):
//
// drizzle-kit's migration history is per-`out`-directory. Each `out` dir owns a
// single self-contained journal (`meta/_journal.json`) and a monotonic snapshot
// chain (0000_snapshot.json, 0001_…). `drizzle-kit generate` diffs the config's
// ENTIRE `schema` surface against the latest snapshot in that ONE `out` dir and
// appends the next-numbered migration there. A `Config` object has exactly ONE
// `out` — there is no way to route two schema barrels to two different `out`
// dirs from a single config.
//
// The bookings config (./drizzle.config.ts) points `schema` at the bookings
// barrel and `out` at ./modules/bookings/schema/migrations (journal already at
// idx 0 → 0000_blushing_multiple_man). If we merged the audit barrel into that
// SAME config, the next `generate` would diff (bookings + audit) against the
// bookings 0000 snapshot and write an 0001 audit migration INTO the bookings
// migrations dir — mutating a bookings-owned history and mixing audit DDL into
// it. That clobbers the existing bookings migrations (explicitly forbidden) and
// breaks module isolation (ddd-architecture §2): two independently-purgeable
// modules would share one migration journal.
//
// The bookings config comment already anticipated this: "out … kept module-local
// so adding another module later does not require restructuring this config."
// The isolation-preserving, non-clobbering resolution is therefore a SECOND,
// audit-scoped config with its own module-local `out`. Audit gets a clean journal
// numbered from 0000; bookings' dir is never touched.
//
// Usage:
//   pnpm drizzle-kit generate --config=drizzle.audit.config.ts   (offline diff)
//   pnpm drizzle-kit migrate  --config=drizzle.audit.config.ts   (deploy pipeline)
// A `db:generate:audit` / `db:migrate:audit` script is added to package.json for
// convenience. The deploy pipeline runs BOTH configs' `migrate` (order-independent
// — the two modules share one Postgres DB on one DATABASE_URL but no cross-module
// objects, so their DDL does not depend on each other).
//
// Decisions (mirror ./drizzle.config.ts):
//   - dialect: 'postgresql' — same Neon + pg-driver storage as bookings.
//   - dbCredentials.url: DATABASE_URL from the env. `generate` reads the SCHEMA,
//     not a live DB, so no real URL is required to generate; only `migrate` /
//     `push` / `studio` consult the database. Generating this module's SQL is a
//     fully OFFLINE operation.
//   - schema: the audit module barrel (the module's single allowed barrel).
//   - out: a migrations dir under the audit module — module-local, mirroring the
//     bookings layout, so the audit journal is self-contained and isolated.
// =============================================================================

import type { Config } from 'drizzle-kit';

export default {
  schema: './modules/audit/schema/index.ts',
  out: './modules/audit/schema/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;
