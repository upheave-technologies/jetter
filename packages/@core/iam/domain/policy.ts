// =============================================================================
// Domain — Policy Entity
// =============================================================================
// A Policy is the agnostic equivalent of "Roles" — a named, reusable bundle
// of actions. Policies define WHAT can be done. They are assigned to Principals
// via Entitlements.
//
// PolicyScope determines whether a Policy applies platform-wide or within a
// Tenant boundary:
//   - PLATFORM: Applies regardless of Tenant context
//   - TENANT: Applies only within a specific Tenant
//
// This module provides pure functions for creating and validating policies.
// Adapted from reference code: domain/role.ts
// =============================================================================

import { Result } from '../../../shared/lib/result';

export type PolicyScope = 'PLATFORM' | 'TENANT';

export type Policy = {
  id: string;
  name: string;
  scope: PolicyScope;
  actions: string[]; // JSONB array from Drizzle, e.g. ["campaigns:create:team", "users:read:all"]
  description?: string;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

// =============================================================================
// Pure Validation Functions
// =============================================================================

/**
 * Validates a policy name.
 * Business rules:
 *   - Cannot be empty
 *   - Cannot exceed 100 characters
 */
export const validatePolicyName = (name: string): Result<string, Error> => {
  if (!name || name.trim().length === 0) {
    return {
      success: false,
      error: new Error('Policy name cannot be empty')
    };
  }

  if (name.length > 100) {
    return {
      success: false,
      error: new Error('Policy name cannot exceed 100 characters')
    };
  }

  return { success: true, value: name.trim() };
};

/**
 * Validates policy scope consistency.
 * Business rules:
 *   - PLATFORM scope: tenantId must be null/undefined
 *   - TENANT scope: tenantId must be provided
 */
export const validatePolicyScope = (
  scope: PolicyScope,
  tenantId?: string
): Result<PolicyScope, Error> => {
  // Business rule: Platform policies cannot have tenantId
  if (scope === 'PLATFORM' && tenantId) {
    return {
      success: false,
      error: new Error('PLATFORM policies cannot have a tenantId')
    };
  }

  // Business rule: Tenant policies must have tenantId
  if (scope === 'TENANT' && !tenantId) {
    return {
      success: false,
      error: new Error('TENANT policies must have a tenantId')
    };
  }

  return { success: true, value: scope };
};

/**
 * Creates a new policy with validated data.
 * Returns partial Policy for use case to complete with ID and timestamps.
 */
export const createPolicy = (
  name: string,
  scope: PolicyScope,
  actions: string[],
  description?: string
): Result<Partial<Policy>, Error> => {
  // Validate policy name
  const nameResult = validatePolicyName(name);
  if (!nameResult.success) {
    return nameResult;
  }

  return {
    success: true,
    value: {
      name: nameResult.value,
      scope,
      actions,
      description
    }
  };
};
