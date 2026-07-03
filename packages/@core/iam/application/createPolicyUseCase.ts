// =============================================================================
// Application — Create Policy Use Case
// =============================================================================
// Orchestrates the creation of a new policy.
//
// Flow:
//   1. Check if policy name already exists (application concern)
//   2. Validate policy data using domain functions
//   3. Validate each action string using domain functions
//   4. Generate ID and timestamps (application concern)
//   5. Persist via repository
//
// Adapted from reference code: application/createRoleUseCase.ts
// =============================================================================

import { Result } from '../../../shared/lib/result';
import { createPolicy, Policy, PolicyScope } from '../domain/policy';
import { createAction } from '../domain/action';
import { IPolicyRepository } from '../domain/policyRepository';
import { AccessError } from './accessError';

export type CreatePolicyInput = {
  name: string;
  scope: PolicyScope;
  actions: string[];
  description?: string;
};

/**
 * Higher-order function that creates the createPolicy use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeCreatePolicyUseCase = (
  policyRepository: IPolicyRepository
) => {
  return async (data: CreatePolicyInput): Promise<Result<Policy, AccessError>> => {
    try {
      // Application logic: Check if policy with this name already exists
      const existingPolicy = await policyRepository.findByName(data.name);

      if (existingPolicy) {
        return {
          success: false,
          error: new AccessError(
            'Policy with this name already exists',
            'POLICY_EXISTS'
          )
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

      // Use domain function to create and validate policy
      const policyResult = createPolicy(
        data.name,
        data.scope,
        data.actions,
        data.description
      );

      if (!policyResult.success) {
        return {
          success: false,
          error: new AccessError(policyResult.error.message, 'VALIDATION_ERROR')
        };
      }

      // Create the complete policy entity with ID and timestamps
      const policy: Policy = {
        id: crypto.randomUUID(),
        name: policyResult.value.name!,
        scope: policyResult.value.scope!,
        actions: policyResult.value.actions!,
        description: policyResult.value.description,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Save to repository
      await policyRepository.save(policy);

      return { success: true, value: policy };

    } catch {
      return {
        success: false,
        error: new AccessError('Failed to create policy', 'SERVICE_ERROR')
      };
    }
  };
};
