// =============================================================================
// Infrastructure — Drizzle Principal Repository
// =============================================================================
// Concrete implementation of IPrincipalRepository using Drizzle ORM.
//
// This repository implements all persistence operations for the Principal entity:
//   - Queries include ZOMBIE SHIELD: isNull(deletedAt) on ALL reads by default
//   - The one deliberate exception is findByIdIncludingDeleted — it bypasses
//     the Zombie Shield so callers can distinguish "never existed" from
//     "exists but was soft-deleted" (see method comment for full rationale)
//   - Writes use soft deletes (set deletedAt timestamp, never hard delete)
//   - softDelete sets BOTH deletedAt AND status to 'deactivated' atomically
//     per the RFC — these two fields must always change together
//   - email lookups lowercase input for case-insensitive defense-in-depth
//     (the schema already stores emails lowercased via domain validation, but
//     the repository adds a second layer of normalization at the query boundary)
//   - update() never mutates id or type — these are immutable after creation
//   - Uses Drizzle query builders and operators (eq, and, isNull)
//
// Factory pattern for dependency injection:
//   const repository = makePrincipalRepository(db);
//   await repository.findById('principal-id');
// =============================================================================

import { eq, and, isNull, desc, count, inArray, sql } from 'drizzle-orm';
import { identityPrincipals } from '../../schema/principals';
import { Principal, PrincipalType, PrincipalStatus } from '../../domain/principal';
import { IPrincipalRepository } from '../../domain/principalRepository';
import { IdentityDatabase } from '../database';

/**
 * Factory function that creates a Principal repository instance.
 *
 * @param db - Drizzle database instance with Identity schema
 * @returns IPrincipalRepository implementation
 */
export const makePrincipalRepository = (db: IdentityDatabase): IPrincipalRepository => ({
  /**
   * Find an active Principal by its unique ID.
   * ZOMBIE SHIELD: Filters out soft-deleted principals.
   */
  async findById(id: string): Promise<Principal | null> {
    const result = await db
      .select()
      .from(identityPrincipals)
      .where(and(eq(identityPrincipals.id, id), isNull(identityPrincipals.deletedAt)))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return mapToPrincipal(result[0]);
  },

  /**
   * Find an active Principal by email address (case-insensitive).
   * Defense-in-depth: lowercases input at the query boundary, even though
   * the domain layer already normalizes emails to lowercase on write.
   * ZOMBIE SHIELD: Filters out soft-deleted principals.
   */
  async findByEmail(email: string): Promise<Principal | null> {
    const normalized = email.toLowerCase();

    const result = await db
      .select()
      .from(identityPrincipals)
      .where(
        and(
          eq(identityPrincipals.email, normalized),
          isNull(identityPrincipals.deletedAt),
        ),
      )
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return mapToPrincipal(result[0]);
  },

  /**
   * Find a Principal by ID regardless of its soft-delete state.
   * INTENTIONALLY bypasses the Zombie Shield.
   *
   * This is needed so the deactivate use case can distinguish between:
   *   - Principal does not exist at all           → PRINCIPAL_NOT_FOUND
   *   - Principal exists but is already deleted   → PRINCIPAL_ALREADY_DEACTIVATED
   *
   * Without this method, both cases would return null and be indistinguishable,
   * preventing the use case from returning the correct error code to the caller.
   */
  async findByIdIncludingDeleted(id: string): Promise<Principal | null> {
    const result = await db
      .select()
      .from(identityPrincipals)
      .where(eq(identityPrincipals.id, id))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return mapToPrincipal(result[0]);
  },

  /**
   * Persist a new Principal to storage.
   * Converts undefined domain values to null for database compatibility.
   */
  async save(principal: Principal): Promise<void> {
    await db.insert(identityPrincipals).values({
      id: principal.id,
      type: principal.type,
      status: principal.status,
      name: principal.name,
      email: principal.email ?? null,
      metadata: principal.metadata ?? null,
      deletedAt: principal.deletedAt ?? null,
      createdAt: principal.createdAt,
      updatedAt: principal.updatedAt,
    });
  },

  /**
   * Update mutable fields of an existing Principal in storage.
   * NEVER updates id or type — these are immutable after creation.
   * The caller is responsible for bumping updatedAt before passing the entity.
   */
  async update(principal: Principal): Promise<void> {
    await db
      .update(identityPrincipals)
      .set({
        name: principal.name,
        email: principal.email ?? null,
        status: principal.status,
        metadata: principal.metadata ?? null,
        updatedAt: principal.updatedAt,
      })
      .where(eq(identityPrincipals.id, principal.id));
  },

  /**
   * Soft-delete a Principal by setting its deletedAt timestamp.
   * Also transitions status to 'deactivated' atomically — per the RFC these
   * two fields must always change together in a single DB write.
   * NEVER hard-deletes — preserves audit trail and referential integrity.
   */
  async softDelete(id: string): Promise<void> {
    await db
      .update(identityPrincipals)
      .set({
        deletedAt: new Date(),
        status: 'deactivated',
      })
      .where(eq(identityPrincipals.id, id));
  },

  /**
   * Return a page of active Principals ordered by createdAt DESC then id DESC.
   * The dual-column ordering provides stable pagination — rows inserted at the
   * same millisecond are still deterministically ordered by id.
   * ZOMBIE SHIELD: Filters out soft-deleted principals.
   */
  async findMany({ limit, offset }: { limit: number; offset: number }): Promise<Principal[]> {
    const result = await db
      .select()
      .from(identityPrincipals)
      .where(isNull(identityPrincipals.deletedAt))
      .orderBy(desc(identityPrincipals.createdAt), desc(identityPrincipals.id))
      .limit(limit)
      .offset(offset);

    return result.map(mapToPrincipal);
  },

  /**
   * Return the total count of active (non-soft-deleted) Principals.
   * ZOMBIE SHIELD: Filters out soft-deleted principals.
   */
  async countAll(): Promise<number> {
    const result = await db
      .select({ total: count() })
      .from(identityPrincipals)
      .where(isNull(identityPrincipals.deletedAt));

    return result[0]?.total ?? 0;
  },

  /**
   * Find all active Principals whose metadata contains { seed: true }.
   * Used by the playground reset flow to identify seeded sample members.
   * ZOMBIE SHIELD: Filters out soft-deleted principals.
   */
  async findSeeded(): Promise<Principal[]> {
    const result = await db
      .select()
      .from(identityPrincipals)
      .where(
        and(
          isNull(identityPrincipals.deletedAt),
          sql`${identityPrincipals.metadata}->>'seed' = 'true'`
        )
      );

    return result.map(mapToPrincipal);
  },

  /**
   * Hard-delete multiple Principals by their IDs.
   * INTENTIONAL BYPASS of soft-delete — for playground reset only.
   */
  async hardDeleteMany(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await db
      .delete(identityPrincipals)
      .where(inArray(identityPrincipals.id, ids));
  },
});

// =============================================================================
// Internal Mapping Functions
// =============================================================================

/**
 * Maps a Drizzle query result row to the domain Principal type.
 *
 * Handles type conversions:
 *   - type (enum)              → cast to PrincipalType domain type
 *   - status (enum)            → cast to PrincipalStatus domain type
 *   - email (text | null)      → convert null to undefined
 *   - metadata (jsonb | null)  → cast to Record<string, unknown>, convert null to undefined
 *   - deletedAt (timestamp | null) → convert null to undefined
 */
function mapToPrincipal(row: typeof identityPrincipals.$inferSelect): Principal {
  return {
    id: row.id,
    type: row.type as PrincipalType,
    status: row.status as PrincipalStatus,
    name: row.name,
    email: row.email ?? undefined,
    metadata: (row.metadata as Record<string, unknown> | null) ?? undefined,
    deletedAt: row.deletedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
