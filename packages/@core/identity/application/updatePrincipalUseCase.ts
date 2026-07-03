// =============================================================================
// Application — Update Principal Use Case
// =============================================================================
// Updates mutable fields on an existing active Principal.
// Principal type is immutable after creation and is never accepted as input.
//
// Flow:
//   1. Fetch Principal via repo.findById() — deactivated principals are invisible
//   2. If null, return PRINCIPAL_NOT_FOUND
//   3. If principal.status is 'deactivated', return PRINCIPAL_ALREADY_DEACTIVATED
//      (defensive check: soft-deleted records are excluded by findById, but
//      status-deactivated principals without deletedAt are still handled here)
//   4. Validate name if provided
//   5. Validate email if provided; check uniqueness only when email is changing
//   6. Validate metadata if provided
//   7. Assemble updated Principal with bumped updatedAt
//   8. Persist via repo.update()
//   9. Return the updated Principal
// =============================================================================

import { Result } from '../../../shared/lib/result';
import {
  Principal,
  validatePrincipalEmail,
  validatePrincipalName,
  validateMetadata,
} from '../domain/principal';
import { IPrincipalRepository } from '../domain/principalRepository';
import { IdentityError } from './identityError';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type UpdatePrincipalInput = {
  id: string;
  name?: string;
  email?: string;
  metadata?: Record<string, unknown>;
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the updatePrincipal use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeUpdatePrincipalUseCase = (repo: IPrincipalRepository) => {
  return async (data: UpdatePrincipalInput): Promise<Result<Principal, IdentityError>> => {
    try {
      // Step 1: Fetch active Principal (Zombie Shield filters soft-deleted records)
      const principal = await repo.findById(data.id);

      // Step 2: Not found
      if (principal === null) {
        return {
          success: false,
          error: new IdentityError(
            `Principal with id "${data.id}" was not found`,
            'PRINCIPAL_NOT_FOUND'
          ),
        };
      }

      // Step 3: Defensive deactivation check
      if (principal.status === 'deactivated') {
        return {
          success: false,
          error: new IdentityError(
            'Cannot update a deactivated Principal',
            'PRINCIPAL_ALREADY_DEACTIVATED'
          ),
        };
      }

      // Step 4: Validate name if provided
      let validatedName = principal.name;
      if (data.name !== undefined) {
        const nameResult = validatePrincipalName(data.name);
        if (!nameResult.success) {
          return {
            success: false,
            error: new IdentityError(nameResult.error.message, 'VALIDATION_ERROR'),
          };
        }
        validatedName = nameResult.value;
      }

      // Step 5: Validate email if provided; only check uniqueness when it is actually changing
      let validatedEmail = principal.email;
      if (data.email !== undefined) {
        const emailResult = validatePrincipalEmail(data.email);
        if (!emailResult.success) {
          return {
            success: false,
            error: new IdentityError(emailResult.error.message, 'VALIDATION_ERROR'),
          };
        }

        const normalizedEmail = emailResult.value;

        if (normalizedEmail !== principal.email) {
          const existingByEmail = await repo.findByEmail(normalizedEmail);
          if (existingByEmail !== null) {
            return {
              success: false,
              error: new IdentityError(
                `A Principal with email "${normalizedEmail}" already exists`,
                'EMAIL_ALREADY_EXISTS'
              ),
            };
          }
        }

        validatedEmail = normalizedEmail;
      }

      // Step 6: Validate metadata if provided
      let validatedMetadata = principal.metadata;
      if (data.metadata !== undefined) {
        const metadataResult = validateMetadata(data.metadata);
        if (!metadataResult.success) {
          return {
            success: false,
            error: new IdentityError(metadataResult.error.message, 'VALIDATION_ERROR'),
          };
        }
        validatedMetadata = metadataResult.value;
      }

      // Step 7: Assemble updated Principal
      const updated: Principal = {
        ...principal,
        name: validatedName,
        ...(validatedEmail !== undefined && { email: validatedEmail }),
        ...(validatedMetadata !== undefined && { metadata: validatedMetadata }),
        updatedAt: new Date(),
      };

      // Step 8: Persist
      await repo.update(updated);

      // Step 9: Return updated Principal
      return { success: true, value: updated };
    } catch {
      return {
        success: false,
        error: new IdentityError('Failed to update Principal', 'SERVICE_ERROR'),
      };
    }
  };
};
