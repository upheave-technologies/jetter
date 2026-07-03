// =============================================================================
// Application — Verify API Key Use Case
// =============================================================================
// Orchestrates verifying an API key and resolving the owning Principal.
//
// API Key verification uses a two-phase lookup:
//   Phase 1 — Prefix lookup: narrow candidates to a small bucket using keyPrefix
//   Phase 2 — Hash verification: find exact match via Argon2id comparison
//
// This avoids full-table hash scans while keeping verification secure.
//
// API Key format: nk_{8chars}_{rest}
//   - keyPrefix = rawKey.slice(3, 11)  (skip "nk_", take next 8 chars)
//
// Flow:
//   1. Parse the keyPrefix from the rawKey
//   2. Fetch all candidates matching that keyPrefix
//   3. For each candidate, verify the rawKey against the stored hash
//   4. On match: check expiration, update lastUsedAt, return principalId
//   5. If no candidate matches, return VERIFICATION_FAILED
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

export type VerifyApiKeyInput = {
  rawKey: string;
};

export type VerifyApiKeyOutput = {
  principalId: string;
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the verifyApiKey use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeVerifyApiKeyUseCase = (
  repo: ICredentialRepository,
  hashingService: HashingService
) => {
  return async (
    data: VerifyApiKeyInput
  ): Promise<Result<VerifyApiKeyOutput, AuthError>> => {
    try {
      // Step 1: Parse the keyPrefix from the rawKey
      // Format: nk_{8chars}_{rest} — skip "nk_" (3 chars), take next 8 chars
      const keyPrefix = data.rawKey.slice(3, 11);

      // Step 2: Fetch all candidates matching that keyPrefix (O(1) bucket lookup)
      const candidates = await repo.findByKeyPrefix(keyPrefix);
      if (candidates.length === 0) {
        return {
          success: false,
          error: new AuthError(
            'No credential found for this API key',
            'CREDENTIAL_NOT_FOUND'
          ),
        };
      }

      // Step 3: Iterate candidates — find the one whose hash matches the rawKey
      for (const candidate of candidates) {
        const isMatch = await hashingService.verify(data.rawKey, candidate.secretHash);

        if (isMatch) {
          // Step 4a: Check expiration
          if (candidate.expiresAt !== undefined && candidate.expiresAt < new Date()) {
            return {
              success: false,
              error: new AuthError('API key has expired', 'EXPIRED_CREDENTIAL'),
            };
          }

          // Step 4b: Update lastUsedAt timestamp
          await repo.updateLastUsedAt(candidate.id);

          // Step 4c: Return the principalId as proof of successful verification
          return { success: true, value: { principalId: candidate.principalId } };
        }
      }

      // Step 5: No candidate matched — verification failed
      return {
        success: false,
        error: new AuthError('API key verification failed', 'VERIFICATION_FAILED'),
      };
    } catch {
      return {
        success: false,
        error: new AuthError('Failed to verify API key', 'SERVICE_ERROR'),
      };
    }
  };
};
