// =============================================================================
// Application — Verify Password Use Case
// =============================================================================
// Orchestrates verifying a password for a Principal.
//
// Flow:
//   1. Find active password credential for the Principal
//   2. Verify the supplied password against the stored hash
//   3. Update lastUsedAt timestamp on success
//   4. Return the principalId as proof of successful verification
// =============================================================================

import { Result } from '../../../shared/lib/result';
import { ICredentialRepository } from '../domain/credentialRepository';
import { AuthError } from './authError';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

type HashingService = {
  hash: (plain: string) => Promise<string>;
  verify: (plain: string, hashed: string) => Promise<boolean>;
};

export type VerifyPasswordInput = {
  principalId: string;
  password: string;
};

export type VerifyPasswordOutput = {
  principalId: string;
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the verifyPassword use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeVerifyPasswordUseCase = (
  repo: ICredentialRepository,
  hashingService: HashingService
) => {
  return async (
    data: VerifyPasswordInput
  ): Promise<Result<VerifyPasswordOutput, AuthError>> => {
    try {
      // Step 1: Find active password credential for Principal
      const credentials = await repo.findByPrincipalAndType(data.principalId, 'password');
      if (credentials.length === 0) {
        return {
          success: false,
          error: new AuthError(
            'No active password credential found for this Principal',
            'CREDENTIAL_NOT_FOUND'
          ),
        };
      }

      // Take the first (only one active password credential per Principal)
      const credential = credentials[0];

      // Step 2: Verify the password against the stored hash
      const isValid = await hashingService.verify(data.password, credential.secretHash);
      if (!isValid) {
        return {
          success: false,
          error: new AuthError('Password verification failed', 'VERIFICATION_FAILED'),
        };
      }

      // Step 3: Update lastUsedAt timestamp
      await repo.updateLastUsedAt(credential.id);

      // Step 4: Return principalId as proof of successful verification
      return { success: true, value: { principalId: data.principalId } };
    } catch {
      return {
        success: false,
        error: new AuthError('Failed to verify password', 'SERVICE_ERROR'),
      };
    }
  };
};
