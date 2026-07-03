#!/usr/bin/env node
// infra/dev-clear.mjs — full DB clear for the jet reservation board (dev only).
//
// Empties the `bookings` table entirely and prints the resulting row count (0).
// Guards against the table not existing yet so it is safe to run on a fresh DB.
//
// Target DB: process.env.DATABASE_URL (the HOST-FACING connection string —
//   host `localhost`, the mapped Postgres port; see infra/.env). This script
//   runs on the host via the node-postgres `pg` driver, so it uses the
//   host-facing URL, NOT the board container's in-network one.
//
// Storage migration: moved from better-sqlite3 (a local file) to the `pg`
// driver. Behaviour is identical — clear the table, report the count.
//
// Run with: pnpm db:clear
//   (export DATABASE_URL first — e.g. `export $(grep -v '^#' infra/.env | xargs)`
//    or `DATABASE_URL=postgres://jet:jet@localhost:5432/jet pnpm db:clear`)

import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('[dev-clear] ERROR: DATABASE_URL is not set.');
  console.error('[dev-clear]   Export it first, e.g.:');
  console.error("[dev-clear]   export $(grep -v '^#' infra/.env | xargs) && pnpm db:clear");
  process.exit(1);
}

const client = new pg.Client({ connectionString });

try {
  await client.connect();

  // Table-exists check — Postgres equivalent of the old sqlite_master probe.
  // to_regclass returns NULL when the relation is absent.
  const { rows: existsRows } = await client.query(
    "SELECT to_regclass('public.bookings') AS reg",
  );
  if (!existsRows[0] || existsRows[0].reg === null) {
    console.log('[dev-clear] bookings table does not exist yet — nothing to clear.');
    console.log('[dev-clear] rows: 0');
    await client.end();
    process.exit(0);
  }

  await client.query('DELETE FROM bookings;');

  const { rows: countRows } = await client.query(
    'SELECT count(*)::int AS count FROM bookings',
  );
  const count = countRows[0].count;

  await client.end();

  console.log('[dev-clear] cleared bookings (PostgreSQL via DATABASE_URL)');
  console.log(`[dev-clear] rows: ${count}`);
} catch (err) {
  console.error('[dev-clear] ERROR while clearing:', err.message);
  await client.end();
  process.exit(1);
}
