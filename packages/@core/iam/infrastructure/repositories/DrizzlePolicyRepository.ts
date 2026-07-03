// =============================================================================
// Infrastructure — Drizzle Policy Repository
// =============================================================================
// Concrete implementation of IPolicyRepository using Drizzle ORM.
//
// This repository implements all persistence operations for the Policy entity:
//   - Queries include ZOMBIE SHIELD: isNull(deletedAt) on ALL reads
//   - Writes use soft deletes (set deletedAt timestamp, never hard delete)
//   - Uses Drizzle query builders and operators (eq, and, isNull)
//
// Factory pattern for dependency injection:
//   const repository = makePolicyRepository(db);
//   await repository.findById('policy-id');
// =============================================================================

import { eq, and, isNull } from 'drizzle-orm';
import { policies } from '../../schema/policies';
import { Policy, PolicyScope } from '../../domain/policy';
import { IPolicyRepository } from '../../domain/policyRepository';
import { IAMDatabase } from '../database';

/**
 * Factory function that creates a Policy repository instance.
 *
 * @param db - Drizzle database instance with IAM schema
 * @returns IPolicyRepository implementation
 */
export const makePolicyRepository = (db: IAMDatabase): IPolicyRepository => ({
  /**
   * Find a policy by its unique ID.
   * ZOMBIE SHIELD: Filters out soft-deleted policies.
   */
  async findById(policyId: string): Promise<Policy | null> {
    const result = await db
      .select()
      .from(policies)
      .where(and(eq(policies.id, policyId), isNull(policies.deletedAt)))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return mapToPolicy(result[0]);
  },

  /**
   * Find a policy by its unique name.
   * ZOMBIE SHIELD: Filters out soft-deleted policies.
   */
  async findByName(name: string): Promise<Policy | null> {
    const result = await db
      .select()
      .from(policies)
      .where(and(eq(policies.name, name), isNull(policies.deletedAt)))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return mapToPolicy(result[0]);
  },

  /**
   * Find all policies with a specific scope (PLATFORM or TENANT).
   * ZOMBIE SHIELD: Only returns active (non-deleted) policies.
   */
  async findByScope(scope: PolicyScope): Promise<Policy[]> {
    const results = await db
      .select()
      .from(policies)
      .where(and(eq(policies.scope, scope), isNull(policies.deletedAt)));

    return results.map(mapToPolicy);
  },

  /**
   * Find all active policies.
   * ZOMBIE SHIELD: Only returns non-deleted policies.
   */
  async findAll(): Promise<Policy[]> {
    const results = await db
      .select()
      .from(policies)
      .where(isNull(policies.deletedAt));

    return results.map(mapToPolicy);
  },

  /**
   * Persist a new policy to storage.
   */
  async save(policy: Policy): Promise<void> {
    await db.insert(policies).values({
      id: policy.id,
      name: policy.name,
      scope: policy.scope,
      actions: policy.actions,
      description: policy.description ?? null,
      createdAt: policy.createdAt,
      updatedAt: policy.updatedAt,
    });
  },

  /**
   * Update an existing policy's actions.
   * Only updates the actions array (not name, scope, or description).
   */
  async update(policy: Policy): Promise<void> {
    await db
      .update(policies)
      .set({
        actions: policy.actions,
        updatedAt: new Date(),
      })
      .where(eq(policies.id, policy.id));
  },

  /**
   * Soft-delete a policy by setting deletedAt timestamp.
   * NEVER hard-deletes — preserves audit trail.
   */
  async softDelete(policyId: string): Promise<void> {
    await db
      .update(policies)
      .set({ deletedAt: new Date() })
      .where(eq(policies.id, policyId));
  },
});

// =============================================================================
// Internal Mapping Functions
// =============================================================================

/**
 * Maps Drizzle query result to domain Policy type.
 *
 * Handles type conversions:
 *   - actions (jsonb) → already typed as string[] via schema
 *   - scope (enum) → cast to PolicyScope domain type
 *   - description (text | null) → convert null to undefined
 *   - deletedAt (timestamp | null) → pass through as-is
 */
function mapToPolicy(row: typeof policies.$inferSelect): Policy {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope as PolicyScope,
    actions: row.actions,
    description: row.description ?? undefined,
    deletedAt: row.deletedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
