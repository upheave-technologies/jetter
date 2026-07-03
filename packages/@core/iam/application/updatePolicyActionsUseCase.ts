// =============================================================================
// Application — Update Policy Actions Use Case
// =============================================================================
// Orchestrates updating a policy's actions array.
//
// Flow:
//   1. Get and validate policy exists
//   2. Validate each new action string using domain functions
//   3. Update policy actions
//   4. Persist via repository
//
// Adapted from reference code: application/assignPermissionsToRoleUseCase.ts
// =============================================================================

import { Result } from '../../../shared/lib/result';
import { createAction } from '../domain/action';
import { IPolicyRepository } from '../domain/policyRepository';
import { AccessError } from './accessError';

export type UpdatePolicyActionsInput = {
  policyId: string;
  actions: string[];
};

/**
 * Higher-order function that creates the updatePolicyActions use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeUpdatePolicyActionsUseCase = (
  policyRepository: IPolicyRepository
) => {
  return async (data: UpdatePolicyActionsInput): Promise<Result<void, AccessError>> => {
    try {
      // Get and validate policy
      const policy = await policyRepository.findById(data.policyId);

      if (!policy) {
        return {
          success: false,
          error: new AccessError('Policy not found', 'POLICY_NOT_FOUND')
        };
      }

      // Validate that at least one action is provided
      if (data.actions.length === 0) {
        return {
          success: false,
          error: new AccessError('At least one action must be provided', 'INVALID_INPUT')
        };
      }

      // Validate each action string using domain function
      for (const actionString of data.actions) {
        const actionResult = createAction(actionString);
        if (!actionResult.success) {
          return {
            success: false,
            error: new AccessError(
              `Invalid action "${actionString}": ${actionResult.error.message}`,
              'VALIDATION_ERROR'
            )
          };
        }
      }

      // Remove duplicate actions
      const uniqueActions = [...new Set(data.actions)];

      // Update policy actions
      policy.actions = uniqueActions;
      policy.updatedAt = new Date();

      // Persist via repository
      await policyRepository.update(policy);

      return { success: true, value: undefined };

    } catch {
      return {
        success: false,
        error: new AccessError('Failed to update policy actions', 'SERVICE_ERROR')
      };
    }
  };
};
