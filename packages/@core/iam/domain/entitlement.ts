// =============================================================================
// Domain — Entitlement Entity
// =============================================================================
// An Entitlement is the assignment of a Policy to a Principal within an
// optional Tenant context. Entitlements answer: "Principal X has Policy Y
// in Tenant Z."
//
// Cross-module soft links (plain text, NO foreign keys):
//   - principalId: References a Principal in the Identity module
//   - tenantId: References a Tenant in the Tenancy module (NULL = PLATFORM)
//   - grantedByPrincipalId: The Principal who granted this entitlement
//
// This module provides pure functions for validating entitlement assignments.
// Adapted from reference code: domain/userContext.ts
// =============================================================================

import { Result } from '../../../shared/lib/result';
import { Policy, PolicyScope } from './policy';

export type Entitlement = {
  id: string;
  principalId: string;
  tenantId?: string | null;
  policyId: string;
  grantedByPrincipalId: string;
  policy: Policy; // Nested policy from Drizzle relational query
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

// =============================================================================
// Pure Validation Functions
// =============================================================================

/**
 * Validates that an entitlement's context matches the policy's scope.
 * Business rules:
 *   - PLATFORM-scoped policies: tenantId must be null/undefined
 *   - TENANT-scoped policies: tenantId must be provided
 */
export const validateEntitlementContext = (
  tenantId: string | undefined | null,
  policyScope: PolicyScope
): Result<void, Error> => {
  // Business rule: Platform policies cannot be assigned with a tenantId
  if (policyScope === 'PLATFORM' && tenantId) {
    return {
      success: false,
      error: new Error('Cannot assign PLATFORM policy to a specific Tenant context')
    };
  }

  // Business rule: Tenant policies must be assigned with a tenantId
  if (policyScope === 'TENANT' && !tenantId) {
    return {
      success: false,
      error: new Error('Cannot assign TENANT policy without a Tenant context')
    };
  }

  return { success: true, value: undefined };
};

/**
 * Validates that a policy can be granted to a principal in a given context.
 * Business rules:
 *   - Policy scope must match context (PLATFORM vs TENANT)
 *   - No duplicate entitlements (same principal + policy + tenant)
 */
export const canGrantEntitlement = (
  _principalId: string,
  tenantId: string | undefined | null,
  policy: Policy,
  existingEntitlements: Entitlement[]
): Result<void, Error> => {
  // Business rule: Policy scope must match context
  const contextResult = validateEntitlementContext(tenantId, policy.scope);
  if (!contextResult.success) {
    return contextResult;
  }

  // Business rule: Check for duplicate entitlement in the same context
  const existingEntitlement = existingEntitlements.find(
    e => e.policyId === policy.id && e.tenantId === tenantId
  );
  if (existingEntitlement) {
    return {
      success: false,
      error: new Error('Policy is already granted to this Principal in this context')
    };
  }

  return { success: true, value: undefined };
};
