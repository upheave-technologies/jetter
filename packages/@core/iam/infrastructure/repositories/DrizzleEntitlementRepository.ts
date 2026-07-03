// =============================================================================
// Infrastructure — Drizzle Entitlement Repository
// =============================================================================
// Concrete implementation of IEntitlementRepository using Drizzle ORM.
//
// This repository implements all persistence operations for the Entitlement entity:
//   - Queries include ZOMBIE SHIELD: isNull(deletedAt) on entitlements
//   - Queries include DOUBLE ZOMBIE SHIELD: filters out entitlements with deleted policies
//   - Uses Drizzle relational queries for JOIN operations (db.query.entitlements.findMany)
//   - Writes use soft deletes (set deletedAt timestamp, never hard delete)
//
// Factory pattern for dependency injection:
//   const repository = makeEntitlementRepository(db);
//   await repository.findByPrincipalAndTenant('principal-id', 'tenant-id');
// =============================================================================

import { eq, and, isNull } from 'drizzle-orm';
import { entitlements } from '../../schema/entitlements';
import { Entitlement } from '../../domain/entitlement';
import { Policy } from '../../domain/policy';
import { IEntitlementRepository } from '../../domain/entitlementRepository';
import { IAMDatabase } from '../database';

/**
 * Factory function that creates an Entitlement repository instance.
 *
 * @param db - Drizzle database instance with IAM schema
 * @returns IEntitlementRepository implementation
 */
export const makeEntitlementRepository = (
  db: IAMDatabase
): IEntitlementRepository => ({
  /**
   * Find all entitlements for a principal in a specific tenant context.
   * ZOMBIE SHIELD: Filters out soft-deleted entitlements.
   * DOUBLE ZOMBIE SHIELD: Filters out entitlements with soft-deleted policies.
   *
   * @param principalId - The principal's unique identifier
   * @param tenantId - Optional tenant context (null = PLATFORM scope, undefined = all contexts)
   */
  async findByPrincipalAndTenant(
    principalId: string,
    tenantId?: string | null
  ): Promise<Entitlement[]> {
    // Build conditions based on tenantId parameter
    const conditions: ReturnType<typeof eq | typeof isNull>[] = [
      eq(entitlements.principalId, principalId),
      isNull(entitlements.deletedAt),
    ];

    if (tenantId === null) {
      // Explicitly requesting PLATFORM scope (no tenant)
      conditions.push(isNull(entitlements.tenantId));
    } else if (tenantId !== undefined) {
      // Specific tenant context
      conditions.push(eq(entitlements.tenantId, tenantId));
    }
    // If tenantId is undefined, don't filter by it (return all contexts)

    // Use Drizzle's relational query API to include policy
    const results = await db.query.entitlements.findMany({
      where: and(...conditions),
      with: {
        policy: true, // Include related policy
      },
    });

    // DOUBLE ZOMBIE SHIELD: Filter out entitlements whose policy is soft-deleted
    const activeResults = results.filter((r) => r.policy.deletedAt === null);

    return activeResults.map(mapToEntitlement);
  },

  /**
   * Find all entitlements for a principal across all contexts.
   * ZOMBIE SHIELD: Filters out soft-deleted entitlements.
   * DOUBLE ZOMBIE SHIELD: Filters out entitlements with soft-deleted policies.
   *
   * @param principalId - The principal's unique identifier
   */
  async findAllByPrincipal(principalId: string): Promise<Entitlement[]> {
    // Use Drizzle's relational query API to include policy
    const results = await db.query.entitlements.findMany({
      where: and(
        eq(entitlements.principalId, principalId),
        isNull(entitlements.deletedAt)
      ),
      with: {
        policy: true, // Include related policy
      },
    });

    // DOUBLE ZOMBIE SHIELD: Filter out entitlements whose policy is soft-deleted
    const activeResults = results.filter((r) => r.policy.deletedAt === null);

    return activeResults.map(mapToEntitlement);
  },

  /**
   * Find a specific entitlement by its unique ID.
   * ZOMBIE SHIELD: Filters out soft-deleted entitlements.
   * DOUBLE ZOMBIE SHIELD: Returns null if policy is soft-deleted.
   */
  async findById(entitlementId: string): Promise<Entitlement | null> {
    // Use Drizzle's relational query API to include policy
    const results = await db.query.entitlements.findMany({
      where: and(
        eq(entitlements.id, entitlementId),
        isNull(entitlements.deletedAt)
      ),
      with: {
        policy: true, // Include related policy
      },
      limit: 1,
    });

    if (results.length === 0) {
      return null;
    }

    // DOUBLE ZOMBIE SHIELD: Check if policy is soft-deleted
    if (results[0].policy.deletedAt !== null) {
      return null;
    }

    return mapToEntitlement(results[0]);
  },

  /**
   * Persist a new entitlement to storage.
   * Note: The nested policy object is NOT saved (it's a read-only relation).
   */
  async save(entitlement: Entitlement): Promise<void> {
    await db.insert(entitlements).values({
      id: entitlement.id,
      principalId: entitlement.principalId,
      tenantId: entitlement.tenantId ?? null,
      policyId: entitlement.policyId,
      grantedByPrincipalId: entitlement.grantedByPrincipalId,
      createdAt: entitlement.createdAt,
      updatedAt: entitlement.updatedAt,
    });
  },

  /**
   * Soft-delete an entitlement by setting deletedAt timestamp.
   * NEVER hard-deletes — preserves audit trail.
   */
  async softDelete(entitlementId: string): Promise<void> {
    await db
      .update(entitlements)
      .set({ deletedAt: new Date() })
      .where(eq(entitlements.id, entitlementId));
  },

  /**
   * Soft-delete entitlements by principal, policy, and tenant context.
   * Used for revoking a specific policy from a principal in a context.
   * NEVER hard-deletes — preserves audit trail.
   *
   * @param principalId - The principal's unique identifier
   * @param policyId - The policy's unique identifier
   * @param tenantId - Optional tenant context (null = PLATFORM scope, undefined = all contexts)
   */
  async softDeleteByPrincipalAndPolicy(
    principalId: string,
    policyId: string,
    tenantId?: string | null
  ): Promise<void> {
    // Build conditions based on tenantId parameter
    const conditions: ReturnType<typeof eq | typeof isNull>[] = [
      eq(entitlements.principalId, principalId),
      eq(entitlements.policyId, policyId),
      isNull(entitlements.deletedAt),
    ];

    if (tenantId === null) {
      // Explicitly targeting PLATFORM scope (no tenant)
      conditions.push(isNull(entitlements.tenantId));
    } else if (tenantId !== undefined) {
      // Specific tenant context
      conditions.push(eq(entitlements.tenantId, tenantId));
    }
    // If tenantId is undefined, don't filter by it (revoke from all contexts)

    await db
      .update(entitlements)
      .set({ deletedAt: new Date() })
      .where(and(...conditions));
  },
});

// =============================================================================
// Internal Mapping Functions
// =============================================================================

/**
 * Maps Drizzle relational query result to domain Entitlement type.
 *
 * Drizzle relational queries return: { ...entitlementFields, policy: { ...policyFields } }
 * We map this to the domain Entitlement type which expects policy: Policy nested.
 *
 * Handles type conversions:
 *   - tenantId (text | null) → convert null to undefined
 *   - deletedAt (timestamp | null) → convert null to undefined
 *   - policy (nested object) → map to domain Policy type
 */
function mapToEntitlement(
  row: {
    id: string;
    principalId: string;
    tenantId: string | null;
    policyId: string;
    grantedByPrincipalId: string;
    deletedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    policy: {
      id: string;
      name: string;
      scope: 'PLATFORM' | 'TENANT';
      actions: string[];
      description: string | null;
      deletedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    };
  }
): Entitlement {
  // Map nested policy to domain Policy type
  const policy: Policy = {
    id: row.policy.id,
    name: row.policy.name,
    scope: row.policy.scope,
    actions: row.policy.actions,
    description: row.policy.description ?? undefined,
    deletedAt: row.policy.deletedAt ?? undefined,
    createdAt: row.policy.createdAt,
    updatedAt: row.policy.updatedAt,
  };

  return {
    id: row.id,
    principalId: row.principalId,
    tenantId: row.tenantId ?? undefined,
    policyId: row.policyId,
    grantedByPrincipalId: row.grantedByPrincipalId,
    policy,
    deletedAt: row.deletedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
