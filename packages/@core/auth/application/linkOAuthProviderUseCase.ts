// =============================================================================
// Application — Link OAuth Provider Use Case
// =============================================================================
// Orchestrates linking an OAuth provider account to a Principal.
//
// Flow:
//   1. Validate principalId, provider, and providerAccountId
//   2. Check no existing link for this provider account
//   3. Hash the access token for secure storage
//   4. Persist the new OAuth credential via repository
//   5. Return the saved credential
// =============================================================================

import { createId } from '@paralleldrive/cuid2';
import { Result } from '../../../shared/lib/result';
import {
  Credential,
  validatePrincipalId,
  validateProvider,
  validateProviderAccountId,
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

export type LinkOAuthProviderInput = {
  principalId: string;
  provider: string;
  providerAccountId: string;
  accessToken: string;
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the linkOAuthProvider use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeLinkOAuthProviderUseCase = (
  repo: ICredentialRepository,
  hashingService: HashingService
) => {
  return async (
    data: LinkOAuthProviderInput
  ): Promise<Result<Credential, AuthError>> => {
    try {
      // Step 1: Validate inputs
      const principalIdResult = validatePrincipalId(data.principalId);
      if (!principalIdResult.success) {
        return {
          success: false,
          error: new AuthError(principalIdResult.error.message, 'VALIDATION_ERROR'),
        };
      }

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

      // Step 2: Check no existing link for this provider account
      const existing = await repo.findByProviderAccount(
        providerResult.value,
        providerAccountIdResult.value
      );
      if (existing !== null) {
        return {
          success: false,
          error: new AuthError(
            'This provider account is already linked to a Principal',
            'PROVIDER_ALREADY_LINKED'
          ),
        };
      }

      // Step 3: Hash the access token for secure storage
      const secretHash = await hashingService.hash(data.accessToken);

      // Step 4: Persist the new OAuth credential
      const now = new Date();
      const credential: Credential = {
        id: createId(),
        principalId: principalIdResult.value,
        type: 'oauth',
        provider: providerResult.value,
        providerAccountId: providerAccountIdResult.value,
        secretHash,
        createdAt: now,
        updatedAt: now,
      };

      await repo.save(credential);

      // Step 5: Return the saved credential
      return { success: true, value: credential };
    } catch {
      return {
        success: false,
        error: new AuthError('Failed to link OAuth provider', 'SERVICE_ERROR'),
      };
    }
  };
};
