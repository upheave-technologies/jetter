// =============================================================================
// Application — Revoke Entitlement Use Case
// =============================================================================
// Orchestrates revoking a policy from a principal in a specific context.
//
// Flow:
//   1. Get and validate policy exists
//   2. Get existing entitlements
//   3. Check if entitlement exists for this principal/policy/tenant
//   4. Soft-delete the entitlement via repository
//
// Adapted from reference code: application/removeRoleFromContextUseCase.ts
// =============================================================================

import { Result } from '../../../shared/lib/result';
import { IEntitlementRepository } from '../domain/entitlementRepository';
import { IPolicyRepository } from '../domain/policyRepository';
import { AccessError } from './accessError';

export type RevokeEntitlementInput = {
  principalId: string;
  policyId: string;
  tenantId?: string | null;
};

/**
 * Higher-order function that creates the revokeEntitlement use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeRevokeEntitlementUseCase = (
  entitlementRepository: IEntitlementRepository,
  policyRepository: IPolicyRepository
) => {
  return async (data: RevokeEntitlementInput): Promise<Result<void, AccessError>> => {
    try {
      // Get policy and validate
      const policy = await policyRepository.findById(data.policyId);

      if (!policy) {
        return {
          success: false,
          error: new AccessError('Policy not found', 'POLICY_NOT_FOUND')
        };
      }

      // Get existing entitlements
      const existingEntitlements = await entitlementRepository.findByPrincipalAndTenant(
        data.principalId,
        data.tenantId
      );

      // Check if policy is actually granted to this principal in this context
      const existingEntitlement = existingEntitlements.find(
        entitlement => entitlement.policyId === data.policyId
      );

      if (!existingEntitlement) {
        return {
          success: false,
          error: new AccessError(
            'Policy is not granted to this Principal in this context',
            'ENTITLEMENT_NOT_FOUND'
          )
        };
      }

      // Soft-delete the entitlement
      await entitlementRepository.softDeleteByPrincipalAndPolicy(
        data.principalId,
        data.policyId,
        data.tenantId
      );

      return { success: true, value: undefined };

    } catch {
      return {
        success: false,
        error: new AccessError('Failed to revoke entitlement', 'SERVICE_ERROR')
      };
    }
  };
};
