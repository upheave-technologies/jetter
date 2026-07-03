// =============================================================================
// Application — Get Principal By Email Use Case
// =============================================================================
// Retrieves a single active Principal by their email address.
//
// Flow:
//   1. Validate email format via domain validatePrincipalEmail()
//   2. Fetch Principal via repo.findByEmail() using the normalized email
//   3. Return the Principal, or PRINCIPAL_NOT_FOUND if null
// =============================================================================

import { Result } from '../../../shared/lib/result';
import { Principal, validatePrincipalEmail } from '../domain/principal';
import { IPrincipalRepository } from '../domain/principalRepository';
import { IdentityError } from './identityError';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type GetPrincipalByEmailInput = {
  email: string;
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the getPrincipalByEmail use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeGetPrincipalByEmailUseCase = (repo: IPrincipalRepository) => {
  return async (
    data: GetPrincipalByEmailInput
  ): Promise<Result<Principal, IdentityError>> => {
    try {
      // Step 1: Validate and normalize the email address
      const emailResult = validatePrincipalEmail(data.email);
      if (!emailResult.success) {
        return {
          success: false,
          error: new IdentityError(emailResult.error.message, 'VALIDATION_ERROR'),
        };
      }

      // Step 2: Fetch active Principal by normalized email
      const principal = await repo.findByEmail(emailResult.value);

      // Step 3: Return result or not-found error
      if (principal === null) {
        return {
          success: false,
          error: new IdentityError(
            `No Principal found with email "${emailResult.value}"`,
            'PRINCIPAL_NOT_FOUND'
          ),
        };
      }

      return { success: true, value: principal };
    } catch {
      return {
        success: false,
        error: new IdentityError('Failed to retrieve Principal by email', 'SERVICE_ERROR'),
      };
    }
  };
};
