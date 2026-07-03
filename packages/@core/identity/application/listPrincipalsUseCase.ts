// =============================================================================
// Application — List Principals Use Case
// =============================================================================
// Returns a paginated slice of active Principals along with the total count
// of all active Principals for page-count calculation.
//
// Flow:
//   1. Fetch a page via repo.findMany({ limit, offset })
//   2. Fetch total via repo.countAll()
//   3. Return { principals, total }
// =============================================================================

import { Result } from '../../../shared/lib/result';
import { Principal } from '../domain/principal';
import { IPrincipalRepository } from '../domain/principalRepository';
import { IdentityError } from './identityError';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type ListPrincipalsInput = {
  limit: number;
  offset: number;
};

export type ListPrincipalsOutput = {
  principals: Principal[];
  total: number;
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the listPrincipals use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeListPrincipalsUseCase = (repo: IPrincipalRepository) => {
  return async (
    data: ListPrincipalsInput
  ): Promise<Result<ListPrincipalsOutput, IdentityError>> => {
    try {
      const [principals, total] = await Promise.all([
        repo.findMany({ limit: data.limit, offset: data.offset }),
        repo.countAll(),
      ]);

      return { success: true, value: { principals, total } };
    } catch {
      return {
        success: false,
        error: new IdentityError('Failed to list Principals', 'SERVICE_ERROR'),
      };
    }
  };
};
