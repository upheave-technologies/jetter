// =============================================================================
// Application — Create Password Credential Use Case
// =============================================================================
// Orchestrates creating a new password credential for a Principal.
//
// Flow:
//   1. Validate principalId is non-empty
//   2. Validate password strength using domain rules
//   3. Check no existing active password credential for this Principal
//   4. Hash the password using Argon2id
//   5. Persist the new credential via repository
//   6. Return the saved credential
// =============================================================================

import { createId } from '@paralleldrive/cuid2';
import { Result } from '../../../shared/lib/result';
import {
  Credential,
  validatePasswordStrength,
  validatePrincipalId,
} from '../domain/credential';
import { ICredentialRepository } from '../domain/credentialRepository';
import { AuthError } from './authError';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

type HashingService = {
  hash: (plain: string) => Promise<string>;
  verify: (plain: string, hashed: string) => Promise<boolean>;
};

export type CreatePasswordCredentialInput = {
  principalId: string;
  password: string;
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the createPasswordCredential use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeCreatePasswordCredentialUseCase = (
  repo: ICredentialRepository,
  hashingService: HashingService
) => {
  return async (
    data: CreatePasswordCredentialInput
  ): Promise<Result<Credential, AuthError>> => {
    try {
      // Step 1: Validate principalId
      const principalIdResult = validatePrincipalId(data.principalId);
      if (!principalIdResult.success) {
        return {
          success: false,
          error: new AuthError(principalIdResult.error.message, 'VALIDATION_ERROR'),
        };
      }

      // Step 2: Validate password strength
      const passwordResult = validatePasswordStrength(data.password);
      if (!passwordResult.success) {
        return {
          success: false,
          error: new AuthError(passwordResult.error.message, 'PASSWORD_TOO_WEAK'),
        };
      }

      // Step 3: Check for existing active password credential
      const existing = await repo.findByPrincipalAndType(data.principalId, 'password');
      if (existing.length > 0) {
        return {
          success: false,
          error: new AuthError(
            'A password credential already exists for this Principal',
            'CREDENTIAL_EXISTS'
          ),
        };
      }

      // Step 4: Hash the password
      const secretHash = await hashingService.hash(data.password);

      // Step 5: Persist the credential
      const now = new Date();
      const credential: Credential = {
        id: createId(),
        principalId: principalIdResult.value,
        type: 'password',
        secretHash,
        createdAt: now,
        updatedAt: now,
      };

      await repo.save(credential);

      // Step 6: Return saved credential
      return { success: true, value: credential };
    } catch {
      return {
        success: false,
        error: new AuthError('Failed to create password credential', 'SERVICE_ERROR'),
      };
    }
  };
};
