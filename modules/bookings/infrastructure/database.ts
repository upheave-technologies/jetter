// =============================================================================
// Bookings Module — Database Singleton (PostgreSQL)
// =============================================================================
// Lazy, process-wide node-postgres Pool + Drizzle instance for the Booth Board.
//
// Connection model:
//   A single `DATABASE_URL` environment variable drives both local Docker
//   Postgres (plain `postgres://...` without sslmode) and Neon's pooled
//   connection string (`postgres://...?sslmode=require`). SSL is not hard-coded
//   here — the `sslmode` in the connection string controls it. Neon's pooled
//   endpoint carries `?sslmode=require`; local Docker Postgres carries none.
//   This keeps one code path for both environments with no env-flag branching.
//
// Schema management:
//   Schema is applied via drizzle-kit migrations (`pnpm db:generate` +
//   `pnpm db:migrate`). There is no boot-time CREATE TABLE bootstrap; the
//   runtime process assumes the schema is already in place before it starts.
//
// Singleton pattern:
//   - Lazy: the Pool is created on the first call to `getBookingsDatabase()`.
//     Safe to import from any number of repositories without paying a
//     connection cost until something actually queries.
//   - Process-wide: subsequent calls return the same Drizzle instance. Sharing
//     one Pool avoids exhausting connection limits on Neon's pooled endpoint.
//   - Pool sizing: max=10, idleTimeoutMillis=30 000. Neon's pooled endpoint
//     multiplexes connections server-side, so a modest client pool is correct
//     and avoids OOM under serverless concurrency spikes.
// =============================================================================

import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';

import { log } from '@/packages/shared/observability';
import * as schema from '../schema';

const dbLog = log.child({ source: 'bookings.database' });

export type BookingsDatabase = NodePgDatabase<typeof schema>;

let cachedDb: BookingsDatabase | null = null;

/**
 * Returns the singleton Bookings database, creating the pg Pool on first call.
 *
 * Throws a descriptive error if `DATABASE_URL` is unset — the caller should
 * catch this at startup (architecture.md §14: errors name the missing config).
 */
export function getBookingsDatabase(): BookingsDatabase {
  if (cachedDb) return cachedDb;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'Missing required environment variable DATABASE_URL. ' +
        'Set it to a PostgreSQL connection string before starting the server.',
    );
  }

  const pool = new Pool({
    connectionString,
    // Modest pool: Neon's pooled endpoint multiplexes behind the scenes, so
    // large client pools waste Neon resources without throughput benefit.
    max: 10,
    idleTimeoutMillis: 30_000,
  });

  dbLog.info('bookings.database.pool_created', {
    maxConnections: 10,
  });

  cachedDb = drizzle(pool, { schema });
  return cachedDb;
}
