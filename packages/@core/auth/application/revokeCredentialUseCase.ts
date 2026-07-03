// =============================================================================
// Application — Revoke Credential Use Case
// =============================================================================
// Orchestrates soft-deleting a single credential by its ID.
//
// Soft deletion is used throughout the auth module to preserve the audit trail.
// Hard deletion is never performed.
//
// Flow:
//   1. Validate credentialId is non-empty
//   2. Confirm the credential exists
//   3. Soft-delete the credential
//   4. Return void on success
// =============================================================================

import { Result } from '../../../shared/lib/result';
import { ICredentialRepository } from '../domain/credentialRepository';
import { AuthError } from './authError';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type RevokeCredentialInput = {
  credentialId: string;
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the revokeCredential use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeRevokeCredentialUseCase = (repo: ICredentialRepository) => {
  return async (
    data: RevokeCredentialInput
  ): Promise<Result<void, AuthError>> => {
    try {
      // Step 1: Validate credentialId is non-empty
      if (!data.credentialId || data.credentialId.trim().length === 0) {
        return {
          success: false,
          error: new AuthError('Credential ID cannot be empty', 'VALIDATION_ERROR'),
        };
      }

      // Step 2: Confirm the credential exists
      const credential = await repo.findById(data.credentialId);
      if (credential === null) {
        return {
          success: false,
          error: new AuthError(
            'No active credential found with the given ID',
            'CREDENTIAL_NOT_FOUND'
          ),
        };
      }

      // Step 3: Soft-delete the credential
      await repo.softDelete(data.credentialId);

      // Step 4: Return void on success
      return { success: true, value: undefined };
    } catch {
      return {
        success: false,
        error: new AuthError('Failed to revoke credential', 'SERVICE_ERROR'),
      };
    }
  };
};
