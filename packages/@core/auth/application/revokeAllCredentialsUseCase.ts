// =============================================================================
// Application — Revoke All Credentials Use Case
// =============================================================================
// Orchestrates soft-deleting ALL active credentials for a Principal.
//
// Used when a Principal account is deactivated or deleted.
// Soft deletion preserves the audit trail — no hard deletes are performed.
//
// Flow:
//   1. Validate principalId
//   2. Soft-delete all active credentials for the Principal
//   3. Return void on success
// =============================================================================

import { Result } from '../../../shared/lib/result';
import { validatePrincipalId } from '../domain/credential';
import { ICredentialRepository } from '../domain/credentialRepository';
import { AuthError } from './authError';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type RevokeAllCredentialsInput = {
  principalId: string;
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the revokeAllCredentials use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeRevokeAllCredentialsUseCase = (repo: ICredentialRepository) => {
  return async (
    data: RevokeAllCredentialsInput
  ): Promise<Result<void, AuthError>> => {
    try {
      // Step 1: Validate principalId
      const principalIdResult = validatePrincipalId(data.principalId);
      if (!principalIdResult.success) {
        return {
          success: false,
          error: new AuthError(principalIdResult.error.message, 'VALIDATION_ERROR'),
        };
      }

      // Step 2: Soft-delete all active credentials for the Principal
      await repo.softDeleteAllByPrincipal(principalIdResult.value);

      // Step 3: Return void on success
      return { success: true, value: undefined };
    } catch {
      return {
        success: false,
        error: new AuthError('Failed to revoke all credentials', 'SERVICE_ERROR'),
      };
    }
  };
};
