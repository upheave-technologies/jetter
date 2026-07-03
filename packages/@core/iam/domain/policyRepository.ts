// =============================================================================
// Domain — Policy Repository Interface
// =============================================================================
// This is the CONTRACT (interface) for policy persistence operations.
// The domain layer defines WHAT it needs, not HOW it's implemented.
//
// The infrastructure layer provides the concrete implementation (e.g., Drizzle).
// Adapted from reference code: domain/roleRepository.ts
// =============================================================================

import { Policy, PolicyScope } from './policy';

export type IPolicyRepository = {
  /**
   * Find a policy by its unique ID.
   * Returns null if not found or soft-deleted.
   */
  findById: (policyId: string) => Promise<Policy | null>;

  /**
   * Find a policy by its unique name.
   * Returns null if not found or soft-deleted.
   */
  findByName: (name: string) => Promise<Policy | null>;

  /**
   * Find all policies with a specific scope (PLATFORM or TENANT).
   * Only returns active (non-deleted) policies.
   */
  findByScope: (scope: PolicyScope) => Promise<Policy[]>;

  /**
   * Find all active policies.
   * Only returns non-deleted policies.
   */
  findAll: () => Promise<Policy[]>;

  /**
   * Persist a new policy to storage.
   */
  save: (policy: Policy) => Promise<void>;

  /**
   * Update an existing policy's actions.
   * Only updates the actions array (not name, scope, or description).
   */
  update: (policy: Policy) => Promise<void>;

  /**
   * Soft-delete a policy by setting deletedAt timestamp.
   * Never hard-deletes — this preserves audit trail.
   */
  softDelete: (policyId: string) => Promise<void>;
};
