// =============================================================================
// Application — Evaluate Access Use Case
// =============================================================================
// Answers the question: "Can Principal X perform Action Y on Resource Z?"
//
// This is the core authorization use case. It loads a principal's entitlements,
// builds a CASL ability, and evaluates a specific permission request.
//
// Flow:
//   1. Validate the action string format
//   2. Load entitlements for the principal (platform + tenant contexts)
//   3. Build CASL ability from entitlements
//   4. Evaluate the permission using CASL
//   5. Return the result
//
// CRITICAL: Platform-scoped entitlements ALWAYS apply, regardless of tenant context.
// A platform admin retains platform permissions even when operating in a tenant.
// =============================================================================

import { Result } from '../../../shared/lib/result';
import { parseAction } from '../domain/action';
import { IEntitlementRepository } from '../domain/entitlementRepository';
import { AccessError } from './accessError';
import { defineAbilityFor } from '../infrastructure/CASLAbilityFactory';

export type EvaluateAccessInput = {
  principalId: string;
  action: string; // Format: "resource:action:scope" (e.g., "campaigns:update:team")
  tenantId?: string | null; // Optional tenant context
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resource?: any; // Optional resource attributes for CASL condition checks
};

export type EvaluateAccessResult = {
  allowed: boolean;
  principalId: string;
  action: string;
  tenantId?: string | null;
};

/**
 * Higher-order function that creates the evaluateAccess use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeEvaluateAccessUseCase = (
  entitlementRepository: IEntitlementRepository
) => {
  return async (
    data: EvaluateAccessInput
  ): Promise<Result<EvaluateAccessResult, AccessError>> => {
    try {
      // Step 1: Validate action format
      const actionParseResult = parseAction(data.action);
      if (!actionParseResult.success) {
        return {
          success: false,
          error: new AccessError(
            `Invalid action format: ${actionParseResult.error.message}`,
            'INVALID_ACTION'
          )
        };
      }

      const { resource: resourceType, action } = actionParseResult.value;

      // Step 2: Load all relevant entitlements
      // CRITICAL: Always include platform-scoped entitlements + tenant-specific ones
      const allEntitlements = await entitlementRepository.findAllByPrincipal(
        data.principalId
      );

      if (allEntitlements.length === 0) {
        // Principal has no entitlements — access denied
        return {
          success: true,
          value: {
            allowed: false,
            principalId: data.principalId,
            action: data.action,
            tenantId: data.tenantId
          }
        };
      }

      // Step 3: Filter entitlements to relevant contexts
      // Include PLATFORM entitlements + tenant-specific entitlements if tenantId specified
      const relevantEntitlements = allEntitlements.filter(entitlement => {
        // Always include platform-scoped entitlements
        if (entitlement.policy.scope === 'PLATFORM') {
          return true;
        }

        // If tenantId is specified, include entitlements for that tenant
        if (data.tenantId && entitlement.tenantId === data.tenantId) {
          return true;
        }

        // If no tenantId specified, include all tenant entitlements
        if (!data.tenantId) {
          return true;
        }

        return false;
      });

      // Step 4: Build CASL ability from entitlements
      const ability = defineAbilityFor(data.principalId, relevantEntitlements);

      // Step 5: Evaluate permission using CASL
      // Only pass resource if it exists (CASL doesn't accept undefined)
      const allowed = data.resource
        ? ability.can(action, resourceType, data.resource)
        : ability.can(action, resourceType);

      return {
        success: true,
        value: {
          allowed,
          principalId: data.principalId,
          action: data.action,
          tenantId: data.tenantId
        }
      };
    } catch {
      return {
        success: false,
        error: new AccessError('Failed to evaluate access', 'SERVICE_ERROR')
      };
    }
  };
};
