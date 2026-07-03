// =============================================================================
// Application — Verify OAuth Provider Use Case
// =============================================================================
// Orchestrates resolving a Principal from an OAuth provider account.
//
// Unlike password verification, OAuth does not require hash verification:
// the OAuth provider has already authenticated the user. This use case
// resolves the Principal linked to the given provider account.
//
// Flow:
//   1. Validate provider and providerAccountId
//   2. Look up the credential by provider account
//   3. Update lastUsedAt timestamp
//   4. Return the principalId as proof of successful resolution
// =============================================================================

import { Result } from '../../../shared/lib/result';
import {
  validateProvider,
  validateProviderAccountId,
} from '../domain/credential';
import { ICredentialRepository } from '../domain/credentialRepository';
import { AuthError } from './authError';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type VerifyOAuthProviderInput = {
  provider: string;
  providerAccountId: string;
};

export type VerifyOAuthProviderOutput = {
  principalId: string;
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the verifyOAuthProvider use case.
 * Follows the factory pattern for dependency injection.
 *
 * No hashing service required — OAuth resolves a Principal by provider link
 * rather than by secret verification.
 */
export const makeVerifyOAuthProviderUseCase = (repo: ICredentialRepository) => {
  return async (
    data: VerifyOAuthProviderInput
  ): Promise<Result<VerifyOAuthProviderOutput, AuthError>> => {
    try {
      // Step 1: Validate inputs
      const providerResult = validateProvider(data.provider);
      if (!providerResult.success) {
        return {
          success: false,
          error: new AuthError(providerResult.error.message, 'VALIDATION_ERROR'),
        };
      }

      const providerAccountIdResult = validateProviderAccountId(data.providerAccountId);
      if (!providerAccountIdResult.success) {
        return {
          success: false,
          error: new AuthError(providerAccountIdResult.error.message, 'VALIDATION_ERROR'),
        };
      }

      // Step 2: Look up the credential by provider account
      const credential = await repo.findByProviderAccount(
        providerResult.value,
        providerAccountIdResult.value
      );
      if (credential === null) {
        return {
          success: false,
          error: new AuthError(
            'No credential found for this provider account',
            'CREDENTIAL_NOT_FOUND'
          ),
        };
      }

      // Step 3: Update lastUsedAt timestamp
      await repo.updateLastUsedAt(credential.id);

      // Step 4: Return principalId as proof of successful resolution
      return { success: true, value: { principalId: credential.principalId } };
    } catch {
      return {
        success: false,
        error: new AuthError('Failed to verify OAuth provider', 'SERVICE_ERROR'),
      };
    }
  };
};
