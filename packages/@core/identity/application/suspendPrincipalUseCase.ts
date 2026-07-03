// =============================================================================
// Application — Suspend Principal Use Case
// =============================================================================
// Temporarily restricts a Principal by transitioning its status to 'suspended'.
// A suspended Principal can be reinstated via reactivatePrincipal.
//
// Flow:
//   1. Fetch Principal via repo.findByIdIncludingDeleted() to distinguish errors
//   2. If null → PRINCIPAL_NOT_FOUND (never existed)
//   3. If deletedAt is set → PRINCIPAL_ALREADY_DEACTIVATED (soft-deleted)
//   4. Validate the status transition (current → 'suspended') via domain rule
//   5. Assemble updated Principal with new status and bumped updatedAt
//   6. Persist via repo.update()
//   7. Return the updated Principal
// =============================================================================

import { Result } from '../../../shared/lib/result';
import { Principal, validateStatusTransition } from '../domain/principal';
import { IPrincipalRepository } from '../domain/principalRepository';
import { IdentityError } from './identityError';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type SuspendPrincipalInput = {
  id: string;
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the suspendPrincipal use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeSuspendPrincipalUseCase = (repo: IPrincipalRepository) => {
  return async (data: SuspendPrincipalInput): Promise<Result<Principal, IdentityError>> => {
    try {
      // Step 1: Bypass Zombie Shield to distinguish not-found from deactivated
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

      // Step 3: Principal is soft-deleted (permanently deactivated)
      if (principal.deletedAt !== undefined) {
        return {
          success: false,
          error: new IdentityError(
            'Cannot suspend a deactivated Principal',
            'PRINCIPAL_ALREADY_DEACTIVATED'
          ),
        };
      }

      // Step 4: Validate the status transition via domain rule
      const transitionResult = validateStatusTransition(principal.status, 'suspended');
      if (!transitionResult.success) {
        return {
          success: false,
          error: new IdentityError(transitionResult.error.message, 'INVALID_STATUS_TRANSITION'),
        };
      }

      // Step 5: Assemble updated Principal
      const updated: Principal = {
        ...principal,
        status: transitionResult.value,
        updatedAt: new Date(),
      };

      // Step 6: Persist
      await repo.update(updated);

      // Step 7: Return updated Principal
      return { success: true, value: updated };
    } catch {
      return {
        success: false,
        error: new IdentityError('Failed to suspend Principal', 'SERVICE_ERROR'),
      };
    }
  };
};
