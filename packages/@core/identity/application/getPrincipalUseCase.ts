// =============================================================================
// Application — Get Principal Use Case
// =============================================================================
// Retrieves a single active Principal by its unique ID.
//
// Flow:
//   1. Fetch Principal via repo.findById() (Zombie Shield active — soft-deleted
//      records are invisible)
//   2. Return the Principal, or PRINCIPAL_NOT_FOUND if null
// =============================================================================

import { Result } from '../../../shared/lib/result';
import { Principal } from '../domain/principal';
import { IPrincipalRepository } from '../domain/principalRepository';
import { IdentityError } from './identityError';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type GetPrincipalInput = {
  id: string;
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the getPrincipal use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeGetPrincipalUseCase = (repo: IPrincipalRepository) => {
  return async (data: GetPrincipalInput): Promise<Result<Principal, IdentityError>> => {
    try {
      // Step 1: Fetch active Principal (soft-deleted records are excluded)
      const principal = await repo.findById(data.id);

      // Step 2: Return result or not-found error
      if (principal === null) {
        return {
          success: false,
          error: new IdentityError(
            `Principal with id "${data.id}" was not found`,
            'PRINCIPAL_NOT_FOUND'
          ),
        };
      }

      return { success: true, value: principal };
    } catch {
      return {
        success: false,
        error: new IdentityError('Failed to retrieve Principal', 'SERVICE_ERROR'),
      };
    }
  };
};
