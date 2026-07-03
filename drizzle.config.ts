// =============================================================================
// Drizzle Kit configuration — SINGLE unified config for the whole app
// =============================================================================
// jet ships exactly TWO tables — `bookings` (modules/bookings) and `audit_events`
// (modules/audit) — into ONE Postgres database (Neon in prod, local Docker
// Postgres in dev) behind one connection. There is ONE drizzle-kit config, ONE
// migrations directory, and ONE `drizzle-kit migrate` run in the Vercel build.
//
// WHY ONE CONFIG (the two-config design is retired — migrate-on-deploy DEC-MD12):
//   The previous design had two configs (this one + drizzle.audit.config.ts),
//   each with its own `out` dir and journal, both left on drizzle-kit's DEFAULT
//   bookkeeping table `drizzle.__drizzle_migrations`. drizzle-orm 0.36's pg
//   migrator gates on a SINGLE WATERMARK (apply iff a migration's journal `when`
//   is greater than MAX(created_at) in the bookkeeping table), NOT a per-hash
//   check. Because the audit journal's timestamps predate the bookings journal's
//   latest, once the bookings set advanced the shared watermark the audit set was
//   seen as "already applied" and SILENTLY SKIPPED on every deploy — so
//   audit_events was never created on live, while the log said "migrations applied
//   successfully". One config with one journal and one watermark makes that bug
//   structurally impossible: there is only ever ONE migration set sharing the
//   default table with itself, which is exactly what the default is for.
//
// Decisions:
//   - dialect: 'postgresql' — Neon + node-postgres `pg` driver.
//   - schema: BOTH module barrels, via drizzle-kit's array form (verified
//     supported by drizzle-kit 0.28.1 — Config.schema is `string | string[]`).
//     `generate` diffs the COMBINED surface (bookings + audit) against the last
//     snapshot in `out`, so both tables live in one journal.
//   - out: the EXISTING bookings migrations dir. It already holds the proven,
//     already-applied bookings 0000/0001 SQL + their valid snapshot chain. Reusing
//     it (vs. relocating everything to a neutral ./drizzle/migrations) is the
//     lower-risk choice: the existing journal + snapshots are never moved or
//     re-linked; the audit objects are appended as a NEW migration with a fresh
//     (later) timestamp. Nothing about the already-applied bookings history moves.
//   - dbCredentials.url: prefer NEON_DIRECT_DATABASE_URL, fall back to
//     DATABASE_URL. `drizzle-kit migrate` opens a long multi-statement session;
//     Neon's pooled (`-pooler`, pgbouncer TRANSACTION-pooling) url breaks/hangs
//     that session, so migrations MUST use the DIRECT (non-pooled) url. The
//     running app keeps using the pooled DATABASE_URL — only migrate needs the
//     direct one. (`generate` reads the SCHEMA, not the DB, so no real url is
//     needed to generate; only migrate/push/studio consult dbCredentials.)
//   - migrations: (INTENTIONALLY ABSENT — do NOT add a custom table). With ONE
//     set, drizzle-kit's DEFAULT `drizzle.__drizzle_migrations` is correct. The
//     old bug was TWO sets SHARING that default table's single watermark; one set
//     sharing it with itself is exactly the intended use. On live, the default
//     table already records bookings 0000/0001 (watermark = 1783082563139), so the
//     next migrate skips them and applies only the newer audit migration(s).
// =============================================================================

import type { Config } from 'drizzle-kit';

export default {
  schema: [
    './modules/bookings/schema/index.ts',
    './modules/audit/schema/index.ts',
  ],
  out: './modules/bookings/schema/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    // Direct (non-pooled) url for migrate; pooled DATABASE_URL breaks the
    // multi-statement migration session on Neon (pgbouncer transaction pooling).
    url: process.env.NEON_DIRECT_DATABASE_URL ?? process.env.DATABASE_URL!,
  },
} satisfies Config;
