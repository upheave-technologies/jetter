// =============================================================================
// Application — Grant Entitlement Use Case
// =============================================================================
// Orchestrates granting a policy to a principal in a specific context.
//
// Flow:
//   1. Get and validate policy exists
//   2. Get existing entitlements for validation
//   3. Validate using domain function (scope match, no duplicates)
//   4. Create entitlement entity
//   5. Persist via repository
//
// Adapted from reference code: application/assignRoleToContextUseCase.ts
// =============================================================================

import { Result } from '../../../shared/lib/result';
import { canGrantEntitlement, Entitlement } from '../domain/entitlement';
import { IEntitlementRepository } from '../domain/entitlementRepository';
import { IPolicyRepository } from '../domain/policyRepository';
import { AccessError } from './accessError';

export type GrantEntitlementInput = {
  principalId: string;
  policyId: string;
  tenantId?: string | null;
  grantedByPrincipalId: string;
};

/**
 * Higher-order function that creates the grantEntitlement use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeGrantEntitlementUseCase = (
  entitlementRepository: IEntitlementRepository,
  policyRepository: IPolicyRepository
) => {
  return async (data: GrantEntitlementInput): Promise<Result<Entitlement, AccessError>> => {
    try {
      // Get policy and validate
      const policy = await policyRepository.findById(data.policyId);

      if (!policy) {
        return {
          success: false,
          error: new AccessError('Policy not found', 'POLICY_NOT_FOUND')
        };
      }

      // Get existing entitlements for validation
      const existingEntitlements = await entitlementRepository.findByPrincipalAndTenant(
        data.principalId,
        data.tenantId
      );

      // Use domain function to validate entitlement grant
      const grantResult = canGrantEntitlement(
        data.principalId,
        data.tenantId,
        policy,
        existingEntitlements
      );

      if (!grantResult.success) {
        return {
          success: false,
          error: new AccessError(grantResult.error.message, 'GRANT_DENIED')
        };
      }

      // Create the entitlement entity
      const entitlement: Entitlement = {
        id: crypto.randomUUID(),
        principalId: data.principalId,
        tenantId: data.tenantId || null,
        policyId: data.policyId,
        grantedByPrincipalId: data.grantedByPrincipalId,
        policy: policy,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Persist via repository
      await entitlementRepository.save(entitlement);

      return { success: true, value: entitlement };

    } catch {
      return {
        success: false,
        error: new AccessError('Failed to grant entitlement', 'SERVICE_ERROR')
      };
    }
  };
};
