// =============================================================================
// Application — Create Principal Use Case
// =============================================================================
// Orchestrates the creation of a new Principal in the system.
//
// Flow:
//   1. Validate type, name, email, and metadata via domain createPrincipal()
//   2. If email provided, check uniqueness via repo.findByEmail()
//   3. Generate a cuid2 ID
//   4. Assemble full Principal with status 'active' and timestamps
//   5. Persist via repo.save()
//   6. Return the created Principal
// =============================================================================

import { createId } from '@paralleldrive/cuid2';
import { Result } from '../../../shared/lib/result';
import { Principal, createPrincipal } from '../domain/principal';
import { IPrincipalRepository } from '../domain/principalRepository';
import { IdentityError } from './identityError';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type CreatePrincipalInput = {
  type: string;
  name: string;
  email?: string;
  metadata?: Record<string, unknown>;
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the createPrincipal use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeCreatePrincipalUseCase = (repo: IPrincipalRepository) => {
  return async (data: CreatePrincipalInput): Promise<Result<Principal, IdentityError>> => {
    try {
      // Step 1: Validate all input fields via domain factory function
      const principalResult = createPrincipal({
        type: data.type,
        name: data.name,
        email: data.email,
        metadata: data.metadata,
      });

      if (!principalResult.success) {
        return {
          success: false,
          error: new IdentityError(principalResult.error.message, 'VALIDATION_ERROR'),
        };
      }

      // Step 2: Check email uniqueness if an email was provided
      if (principalResult.value.email !== undefined) {
        const existingByEmail = await repo.findByEmail(principalResult.value.email);
        if (existingByEmail !== null) {
          return {
            success: false,
            error: new IdentityError(
              `A Principal with email "${principalResult.value.email}" already exists`,
              'EMAIL_ALREADY_EXISTS'
            ),
          };
        }
      }

      // Step 3–4: Assemble full Principal entity
      const now = new Date();
      const principal: Principal = {
        id: createId(),
        type: principalResult.value.type,
        status: 'active',
        name: principalResult.value.name,
        ...(principalResult.value.email !== undefined && { email: principalResult.value.email }),
        ...(principalResult.value.metadata !== undefined && {
          metadata: principalResult.value.metadata,
        }),
        createdAt: now,
        updatedAt: now,
      };

      // Step 5: Persist
      await repo.save(principal);

      // Step 6: Return created Principal
      return { success: true, value: principal };
    } catch {
      return {
        success: false,
        error: new IdentityError('Failed to create Principal', 'SERVICE_ERROR'),
      };
    }
  };
};
