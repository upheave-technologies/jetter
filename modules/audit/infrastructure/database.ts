// =============================================================================
// Audit Module — Database Singleton (PostgreSQL)
// =============================================================================
// Lazy, process-wide node-postgres Pool + Drizzle instance for the audit log.
//
// Connection model:
//   Same DATABASE_URL as the bookings module — both modules share one Postgres
//   database. This design decision (shared DB, one DATABASE_URL) is documented
//   in SPEC DEC-AU6: it makes a shared transaction across booking mutation +
//   audit append POSSIBLE if the same pg Pool/connection is used. However,
//   strict module isolation means each module owns its own Drizzle instance
//   wrapping its own schema. See DEC-AU6 atomicity discussion in use case files.
//
// Singleton pattern:
//   Lazy: Pool created on first call to getAuditDatabase().
//   Process-wide: subsequent calls return the same Drizzle instance.
//   Mirrors modules/bookings/infrastructure/database.ts exactly.
// =============================================================================

import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';

import { log } from '@/packages/shared/observability';
import * as schema from '../schema';

const dbLog = log.child({ source: 'audit.database' });

export type AuditDatabase = NodePgDatabase<typeof schema>;

let cachedDb: AuditDatabase | null = null;

/**
 * Returns the singleton Audit database, creating the pg Pool on first call.
 *
 * Throws a descriptive error if `DATABASE_URL` is unset.
 */
export function getAuditDatabase(): AuditDatabase {
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
    max: 10,
    idleTimeoutMillis: 30_000,
  });

  dbLog.info('audit.database.pool_created', {
    maxConnections: 10,
  });

  cachedDb = drizzle(pool, { schema });
  return cachedDb;
}
