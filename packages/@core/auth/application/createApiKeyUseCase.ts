// =============================================================================
// Application — Create API Key Use Case
// =============================================================================
// Orchestrates creating a new API key credential for a Principal.
//
// API Key format: nk_{keyPrefix}_{rest}
//   - keyPrefix: first 8 hex chars of a 64-char hex string (from 32 random bytes)
//   - Used for O(1) bucket lookup during verification
//   - The full raw key is returned EXACTLY ONCE — it cannot be recovered later
//
// Flow:
//   1. Validate principalId
//   2. Generate a cryptographically secure random key
//   3. Extract the keyPrefix for fast lookup
//   4. Hash the full raw key for secure storage
//   5. Persist the new API key credential
//   6. Return the credential AND the raw key (returned once only)
// =============================================================================

import { randomBytes } from 'node:crypto';
import { createId } from '@paralleldrive/cuid2';
import { Result } from '../../../shared/lib/result';
import { Credential, validatePrincipalId } from '../domain/credential';
import { ICredentialRepository } from '../domain/credentialRepository';
import { AuthError } from './authError';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

type HashingService = {
  hash: (plain: string) => Promise<string>;
  verify: (plain: string, hashed: string) => Promise<boolean>;
};

export type CreateApiKeyInput = {
  principalId: string;
  expiresAt?: Date;
};

export type CreateApiKeyOutput = {
  credential: Credential;
  rawKey: string;
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the createApiKey use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeCreateApiKeyUseCase = (
  repo: ICredentialRepository,
  hashingService: HashingService
) => {
  return async (
    data: CreateApiKeyInput
  ): Promise<Result<CreateApiKeyOutput, AuthError>> => {
    try {
      // Step 1: Validate principalId
      const principalIdResult = validatePrincipalId(data.principalId);
      if (!principalIdResult.success) {
        return {
          success: false,
          error: new AuthError(principalIdResult.error.message, 'VALIDATION_ERROR'),
        };
      }

      // Step 2: Generate a cryptographically secure random key (32 bytes = 64 hex chars)
      const hexString = randomBytes(32).toString('hex');

      // Step 3: Extract keyPrefix (first 8 hex chars) and format the raw key
      const keyPrefix = hexString.slice(0, 8);
      const rawKey = `nk_${hexString.slice(0, 8)}_${hexString.slice(8)}`;

      // Step 4: Hash the full raw key for secure storage
      const secretHash = await hashingService.hash(rawKey);

      // Step 5: Persist the new API key credential
      const now = new Date();
      const credential: Credential = {
        id: createId(),
        principalId: principalIdResult.value,
        type: 'api_key',
        secretHash,
        keyPrefix,
        expiresAt: data.expiresAt,
        createdAt: now,
        updatedAt: now,
      };

      await repo.save(credential);

      // Step 6: Return the credential and the raw key (returned EXACTLY ONCE)
      return { success: true, value: { credential, rawKey } };
    } catch {
      return {
        success: false,
        error: new AuthError('Failed to create API key', 'SERVICE_ERROR'),
      };
    }
  };
};
