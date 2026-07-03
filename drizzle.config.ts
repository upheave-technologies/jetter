// =============================================================================
// Drizzle Kit configuration
// =============================================================================
// The Booth Board runs on PostgreSQL (Neon in production, local Docker Postgres
// in dev) via the node-postgres `pg` driver behind a single `DATABASE_URL`.
// Schema provisioning is done with REAL drizzle-kit migrations — `drizzle-kit
// generate` writes versioned SQL under `out/`, and `drizzle-kit migrate`
// (run by the deploy pipeline / dev tooling) applies it. This replaces the old
// SQLite lazy `CREATE TABLE IF NOT EXISTS` bootstrap, which is gone.
//
// Decisions:
//   - dialect: 'postgresql' — the storage migration (Neon + pg driver).
//   - dbCredentials.url: `DATABASE_URL` from the environment. NOTE: `generate`
//     reads the schema, not a live DB, so a real URL is NOT required to generate
//     migrations; it is only consulted by commands that touch the database
//     (`migrate`, `push`, `studio`).
//   - schema: the bookings module barrel (the single allowed barrel).
//   - out: a migrations dir under the bookings module — kept module-local so
//     adding another module later does not require restructuring this config.
// =============================================================================

import type { Config } from 'drizzle-kit';

export default {
  schema: './modules/bookings/schema/index.ts',
  out: './modules/bookings/schema/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;
