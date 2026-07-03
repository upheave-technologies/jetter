// =============================================================================
// Application — Deactivate Principal Use Case
// =============================================================================
// Permanently disables a Principal by validating the status transition and
// soft-deleting the record. Deactivation is irreversible.
//
// Flow:
//   1. Fetch Principal via repo.findByIdIncludingDeleted() to distinguish errors
//   2. If null → PRINCIPAL_NOT_FOUND (never existed)
//   3. If deletedAt is set → PRINCIPAL_ALREADY_DEACTIVATED (already soft-deleted)
//   4. Validate the status transition (current → 'deactivated') via domain rule
//   5. Soft-delete via repo.softDelete() — sets deletedAt, preserves the record
//   6. Return void success
// =============================================================================

import { Result } from '../../../shared/lib/result';
import { validateStatusTransition } from '../domain/principal';
import { IPrincipalRepository } from '../domain/principalRepository';
import { IdentityError } from './identityError';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type DeactivatePrincipalInput = {
  id: string;
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the deactivatePrincipal use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeDeactivatePrincipalUseCase = (repo: IPrincipalRepository) => {
  return async (
    data: DeactivatePrincipalInput
  ): Promise<Result<void, IdentityError>> => {
    try {
      // Step 1: Bypass Zombie Shield to distinguish not-found from already-deactivated
      const principal = await repo.findByIdIncludingDeleted(data.id);

      // Step 2: Principal never existed
      if (principal === null) {
        return {
          success: false,
          error: new IdentityError(
            `Principal with id "${data.id}" was not found`,
            'PRINCIPAL_NOT_FOUND'
          ),
        };
      }

      // Step 3: Already soft-deleted
      if (principal.deletedAt !== undefined) {
        return {
          success: false,
          error: new IdentityError(
            'Principal has already been deactivated',
            'PRINCIPAL_ALREADY_DEACTIVATED'
          ),
        };
      }

      // Step 4: Validate the status transition via domain rule
      const transitionResult = validateStatusTransition(principal.status, 'deactivated');
      if (!transitionResult.success) {
        return {
          success: false,
          error: new IdentityError(transitionResult.error.message, 'INVALID_STATUS_TRANSITION'),
        };
      }

      // Step 5: Soft-delete — sets deletedAt, record is preserved for audit trail
      await repo.softDelete(data.id);

      // Step 6: Return void success
      return { success: true, value: undefined };
    } catch {
      return {
        success: false,
        error: new IdentityError('Failed to deactivate Principal', 'SERVICE_ERROR'),
      };
    }
  };
};
