// =============================================================================
// Application — Has Active Credential Use Case
// =============================================================================
// Checks whether a Principal has at least one active credential.
// Optionally filtered by credential type.
//
// Useful for onboarding gates, account status checks, and access guards.
//
// Flow:
//   1. Validate principalId
//   2. Query repository for active credential existence
//   3. Return the boolean result
// =============================================================================

import { Result } from '../../../shared/lib/result';
import { CredentialType, validatePrincipalId } from '../domain/credential';
import { ICredentialRepository } from '../domain/credentialRepository';
import { AuthError } from './authError';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type HasActiveCredentialInput = {
  principalId: string;
  type?: CredentialType;
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the hasActiveCredential use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeHasActiveCredentialUseCase = (repo: ICredentialRepository) => {
  return async (
    data: HasActiveCredentialInput
  ): Promise<Result<boolean, AuthError>> => {
    try {
      // Step 1: Validate principalId
      const principalIdResult = validatePrincipalId(data.principalId);
      if (!principalIdResult.success) {
        return {
          success: false,
          error: new AuthError(principalIdResult.error.message, 'VALIDATION_ERROR'),
        };
      }

      // Step 2: Query repository for active credential existence
      const result = await repo.hasActiveCredential(principalIdResult.value, data.type);

      // Step 3: Return the boolean result
      return { success: true, value: result };
    } catch {
      return {
        success: false,
        error: new AuthError('Failed to check active credential', 'SERVICE_ERROR'),
      };
    }
  };
};
