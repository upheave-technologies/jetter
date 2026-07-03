// =============================================================================
// Domain — Entitlement Repository Interface
// =============================================================================
// This is the CONTRACT (interface) for entitlement persistence operations.
// The domain layer defines WHAT it needs, not HOW it's implemented.
//
// The infrastructure layer provides the concrete implementation (e.g., Drizzle).
// Adapted from reference code: domain/userContextRepository.ts
// =============================================================================

import { Entitlement } from './entitlement';

export type IEntitlementRepository = {
  /**
   * Find all entitlements for a principal in a specific tenant context.
   * Returns only active (non-deleted) entitlements with nested policy data.
   */
  findByPrincipalAndTenant: (
    principalId: string,
    tenantId?: string | null
  ) => Promise<Entitlement[]>;

  /**
   * Find all entitlements for a principal across all contexts.
   * Returns only active (non-deleted) entitlements with nested policy data.
   */
  findAllByPrincipal: (principalId: string) => Promise<Entitlement[]>;

  /**
   * Find a specific entitlement by its unique ID.
   * Returns null if not found or soft-deleted.
   */
  findById: (entitlementId: string) => Promise<Entitlement | null>;

  /**
   * Persist a new entitlement to storage.
   */
  save: (entitlement: Entitlement) => Promise<void>;

  /**
   * Soft-delete an entitlement by setting deletedAt timestamp.
   * Never hard-deletes — this preserves audit trail.
   */
  softDelete: (entitlementId: string) => Promise<void>;

  /**
   * Soft-delete entitlements by principal, policy, and tenant context.
   * Used for revoking a specific policy from a principal in a context.
   */
  softDeleteByPrincipalAndPolicy: (
    principalId: string,
    policyId: string,
    tenantId?: string | null
  ) => Promise<void>;
};
