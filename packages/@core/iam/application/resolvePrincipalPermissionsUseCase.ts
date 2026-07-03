// =============================================================================
// Application — Resolve Principal Permissions Use Case
// =============================================================================
// Resolves all effective permissions for a principal, optionally filtered by
// tenant context.
//
// Flow:
//   1. Get all entitlements for principal (filtered by tenant if specified)
//   2. Aggregate all policy actions across all entitlements
//   3. Deduplicate actions
//   4. Return grouped by context (tenant)
//
// Adapted from reference code: application/getUserPermissionsUseCase.ts
// =============================================================================

import { Result } from '../../../shared/lib/result';
import { IEntitlementRepository } from '../domain/entitlementRepository';
import { AccessError } from './accessError';

export type ResolvePrincipalPermissionsInput = {
  principalId: string;
  tenantId?: string | null;
};

export type PrincipalPermissionsResult = {
  principalId: string;
  tenantId?: string | null;
  actions: string[]; // Flat list of deduplicated action strings
};

/**
 * Higher-order function that creates the resolvePrincipalPermissions use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeResolvePrincipalPermissionsUseCase = (
  entitlementRepository: IEntitlementRepository
) => {
  return async (
    data: ResolvePrincipalPermissionsInput
  ): Promise<Result<PrincipalPermissionsResult[], AccessError>> => {
    try {
      let permissionContexts: PrincipalPermissionsResult[];

      if (data.tenantId !== undefined) {
        // Get entitlements for specific tenant context
        const entitlements = await entitlementRepository.findByPrincipalAndTenant(
          data.principalId,
          data.tenantId
        );

        if (entitlements.length === 0) {
          return {
            success: false,
            error: new AccessError('No entitlements found for this context', 'CONTEXT_NOT_FOUND')
          };
        }

        // Collect all actions from all policy entitlements
        const allActions: string[] = [];
        for (const entitlement of entitlements) {
          allActions.push(...entitlement.policy.actions);
        }

        // Deduplicate actions
        const uniqueActions = [...new Set(allActions)];

        permissionContexts = [{
          principalId: data.principalId,
          tenantId: data.tenantId,
          actions: uniqueActions
        }];

      } else {
        // Get all entitlements across all contexts
        const allEntitlements = await entitlementRepository.findAllByPrincipal(data.principalId);

        if (allEntitlements.length === 0) {
          return {
            success: false,
            error: new AccessError('No entitlements found for this principal', 'CONTEXT_NOT_FOUND')
          };
        }

        // Group entitlements by tenant context
        const contextMap = new Map<string, string[]>();

        for (const entitlement of allEntitlements) {
          const key = entitlement.tenantId || 'PLATFORM';
          if (!contextMap.has(key)) {
            contextMap.set(key, []);
          }
          // Collect all actions from this entitlement's policy
          contextMap.get(key)!.push(...entitlement.policy.actions);
        }

        // Build result array with deduplicated actions per context
        permissionContexts = [];
        for (const [key, actions] of contextMap) {
          const tenantId = key === 'PLATFORM' ? null : key;
          const uniqueActions = [...new Set(actions)];

          permissionContexts.push({
            principalId: data.principalId,
            tenantId,
            actions: uniqueActions
          });
        }
      }

      return { success: true, value: permissionContexts };

    } catch {
      return {
        success: false,
        error: new AccessError('Failed to resolve principal permissions', 'SERVICE_ERROR')
      };
    }
  };
};
