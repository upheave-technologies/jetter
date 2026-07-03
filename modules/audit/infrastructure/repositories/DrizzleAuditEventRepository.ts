// =============================================================================
// Audit Module — Drizzle Audit Event Repository
// =============================================================================
// Implements IAuditEventRepository using node-postgres (`pg`) + Drizzle ORM.
//
// Append-only, immutable (SPEC DEC-AU2 / AC-4):
//   - Only append() and two bounded read methods are implemented.
//   - No update, no softDelete, no hard delete. The interface intentionally
//     does not expose those methods, and this implementation enforces that at
//     the code level.
//
// Mapping conventions:
//   - DB rows use `timestamptz` columns; Drizzle's { mode: 'date' } maps them
//     to JS Date objects at the boundary (see schema/auditEvents.ts).
//   - Nullable jsonb columns are mapped to null in domain types.
//   - Domain types do NOT import schema types; all mapping is in this file.
//
// Observability (donnie-rules §8):
//   - before/after/metadata are jsonb blobs — NEVER logged at info level
//     (they can contain arbitrary domain snapshots; only ids/counts are logged).
//   - Slow query threshold: 200ms (matches bookings repository convention).
//   - Secret-named values are never logged (architecture.md §2).
// =============================================================================

import { desc, eq } from 'drizzle-orm';

import { log } from '@/packages/shared/observability';
import type { AuditEvent, AuditEntityType, AuditAction } from '../../domain/types';
import type { IAuditEventRepository } from '../../domain/repository';
import { auditEvents } from '../../schema';
import { getAuditDatabase, type AuditDatabase } from '../database';

const repoLog = log.child({ source: 'audit.DrizzleAuditEventRepository' });

// ---------------------------------------------------------------------------
// Row ↔ Domain mapping
// ---------------------------------------------------------------------------

type AuditEventRow = {
  id: string;
  occurredAt: Date;
  entityType: string;
  action: string;
  entityId: string | null;
  actor: string;
  summary: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
};

/**
 * Maps a Drizzle-hydrated row to a domain AuditEvent.
 * The repository boundary is where ORM/schema types stop and domain types begin.
 */
function rowToAuditEvent(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    occurredAt: row.occurredAt,
    entityType: row.entityType as AuditEntityType,
    action: row.action as AuditAction,
    entityId: row.entityId,
    actor: row.actor,
    summary: row.summary,
    before: row.before,
    after: row.after,
    metadata: row.metadata,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates an audit event repository backed by the given database instance.
 *
 * @param db - Optional Drizzle database handle. Defaults to the singleton
 *   returned by getAuditDatabase(). Pass a test-scoped instance to isolate
 *   tests without touching the real database.
 */
export function makeAuditEventRepository(
  db?: AuditDatabase,
): IAuditEventRepository {
  const resolvedDb = db ?? getAuditDatabase();

  return {
    async append(event: AuditEvent): Promise<void> {
      const start = Date.now();

      await resolvedDb.insert(auditEvents).values({
        id: event.id,
        occurredAt: event.occurredAt,
        entityType: event.entityType,
        action: event.action,
        entityId: event.entityId,
        actor: event.actor,
        summary: event.summary,
        // before/after/metadata are jsonb blobs; logged only by id/count
        // (donnie-rules §8 — never log full jsonb blob contents at info level).
        before: event.before ?? undefined,
        after: event.after ?? undefined,
        metadata: event.metadata ?? undefined,
      });

      const durationMs = Date.now() - start;
      repoLog.info('audit.event.appended', {
        eventId: event.id,
        entityType: event.entityType,
        action: event.action,
        entityId: event.entityId,
        durationMs,
      });
    },

    async findByEntity(entityId: string, limit: number): Promise<AuditEvent[]> {
      const start = Date.now();

      const rows = await resolvedDb
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.entityId, entityId))
        .orderBy(desc(auditEvents.occurredAt))
        .limit(limit);

      const durationMs = Date.now() - start;
      if (durationMs > 200) {
        repoLog.warn('audit.findByEntity_slow', { entityId, limit, durationMs });
      }

      repoLog.debug('audit.findByEntity.done', {
        entityId,
        count: rows.length,
        durationMs,
      });

      return rows.map(rowToAuditEvent);
    },
  };
}

// ---------------------------------------------------------------------------
// Pre-wired singleton (used by application-layer pre-wired use cases)
// ---------------------------------------------------------------------------

/**
 * Process-wide singleton repository. All use case pre-wired instances share
 * this. Tests should use makeAuditEventRepository(testDb) instead.
 */
export const auditEventRepository = makeAuditEventRepository();

