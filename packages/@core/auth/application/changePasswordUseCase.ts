// =============================================================================
// Application — Change Password Use Case
// =============================================================================
// Orchestrates changing a Principal's password credential.
//
// Flow:
//   1. Find existing active password credential for the Principal
//   2. Verify the current password against the stored hash
//   3. Validate new password strength using domain rules
//   4. Soft-delete the old credential (preserves audit trail)
//   5. Hash the new password and create a new credential
//   6. Return the new credential
// =============================================================================

import { createId } from '@paralleldrive/cuid2';
import { Result } from '../../../shared/lib/result';
import {
  Credential,
  validatePasswordStrength,
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

export type ChangePasswordInput = {
  principalId: string;
  currentPassword: string;
  newPassword: string;
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the changePassword use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeChangePasswordUseCase = (
  repo: ICredentialRepository,
  hashingService: HashingService
) => {
  return async (
    data: ChangePasswordInput
  ): Promise<Result<Credential, AuthError>> => {
    try {
      // Step 1: Find existing active password credential
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

      const oldCredential = credentials[0];

      // Step 2: Verify the current password
      const isValid = await hashingService.verify(data.currentPassword, oldCredential.secretHash);
      if (!isValid) {
        return {
          success: false,
          error: new AuthError('Current password is incorrect', 'INVALID_PASSWORD'),
        };
      }

      // Step 3: Validate new password strength
      const passwordResult = validatePasswordStrength(data.newPassword);
      if (!passwordResult.success) {
        return {
          success: false,
          error: new AuthError(passwordResult.error.message, 'PASSWORD_TOO_WEAK'),
        };
      }

      // Step 4: Soft-delete the old credential
      await repo.softDelete(oldCredential.id);

      // Step 5: Hash the new password and create a new credential
      const secretHash = await hashingService.hash(data.newPassword);
      const now = new Date();
      const newCredential: Credential = {
        id: createId(),
        principalId: data.principalId,
        type: 'password',
        secretHash,
        createdAt: now,
        updatedAt: now,
      };

      await repo.save(newCredential);

      // Step 6: Return the new credential
      return { success: true, value: newCredential };
    } catch {
      return {
        success: false,
        error: new AuthError('Failed to change password', 'SERVICE_ERROR'),
      };
    }
  };
};
