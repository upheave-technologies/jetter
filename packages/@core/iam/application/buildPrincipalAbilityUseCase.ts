// =============================================================================
// Application — Build Principal Ability Use Case
// =============================================================================
// Returns a reusable CASL ability object for a principal.
//
// This is useful when you need to perform MULTIPLE permission checks without
// re-querying the database each time. The returned ability can be used for
// repeated checks within the same request/session.
//
// Flow:
//   1. Load entitlements for the principal (all contexts or filtered)
//   2. Build CASL ability using infrastructure factory
//   3. Return the ability for repeated use
//
// Use Cases:
//   - Middleware: Build once, use for multiple checks in a request
//   - Authorization guards: Build once, check multiple resources
//   - Client-side permissions UI: Build once, show/hide many UI elements
//
// This is the equivalent of the reference's createUserAbility and
// createUserAbilityForOrganization combined.
// =============================================================================

import { Result } from '../../../shared/lib/result';
import { IEntitlementRepository } from '../domain/entitlementRepository';
import { AccessError } from './accessError';
import { defineAbilityFor, AppAbility } from '../infrastructure/CASLAbilityFactory';

export type BuildPrincipalAbilityInput = {
  principalId: string;
  tenantId?: string | null; // Optional: filter to specific tenant + platform
};

/**
 * Higher-order function that creates the buildPrincipalAbility use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeBuildPrincipalAbilityUseCase = (
  entitlementRepository: IEntitlementRepository
) => {
  return async (
    data: BuildPrincipalAbilityInput
  ): Promise<Result<AppAbility, AccessError>> => {
    try {
      // Load all entitlements for the principal
      const allEntitlements = await entitlementRepository.findAllByPrincipal(
        data.principalId
      );

      if (allEntitlements.length === 0) {
        return {
          success: false,
          error: new AccessError(
            'No entitlements found for this principal',
            'NO_ENTITLEMENTS'
          )
        };
      }

      // Filter to relevant contexts if tenantId is specified
      let relevantEntitlements = allEntitlements;

      if (data.tenantId !== undefined) {
        // Include PLATFORM entitlements + tenant-specific entitlements
        relevantEntitlements = allEntitlements.filter(entitlement => {
          // Always include platform-scoped entitlements
          if (entitlement.policy.scope === 'PLATFORM') {
            return true;
          }

          // Include entitlements for the specified tenant
          if (entitlement.tenantId === data.tenantId) {
            return true;
          }

          return false;
        });

        if (relevantEntitlements.length === 0) {
          return {
            success: false,
            error: new AccessError(
              'No entitlements found for this context',
              'CONTEXT_NOT_FOUND'
            )
          };
        }
      }

      // Build and return the CASL ability
      const ability = defineAbilityFor(data.principalId, relevantEntitlements);

      return { success: true, value: ability };
    } catch {
      return {
        success: false,
        error: new AccessError('Failed to build principal ability', 'SERVICE_ERROR')
      };
    }
  };
};
