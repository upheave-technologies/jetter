// =============================================================================
// Infrastructure — CASL Ability Factory
// =============================================================================
// Translates Nucleus IAM entitlements into CASL ability objects for runtime
// permission evaluation.
//
// CASL is a technical mechanism (like Drizzle) — it lives in infrastructure.
// This factory builds CASL rules from the domain's permission model.
//
// Scope Translation:
//   - 'all': Unrestricted access to all resources of a type
//   - 'team': Access scoped to resources within specific tenant(s)
//   - 'own': Access scoped to resources owned by the principal
//
// Adapted from reference: system/to-adapt/iam/code/iam/infrastructure/CASLAbilityFactory.ts
// =============================================================================

import { AbilityBuilder, createMongoAbility } from '@casl/ability';
import { parseAction } from '../domain/action';
import { Entitlement } from '../domain/entitlement';

export type AppAbility = ReturnType<typeof createMongoAbility>;

/**
 * Builds a CASL ability instance from a principal's entitlements.
 *
 * This translates the Nucleus permission model (resource:action:scope) into
 * CASL rules with conditions. Each entitlement's policy actions are parsed
 * and converted to CASL `can()` rules.
 *
 * @param principalId - The principal's unique identifier
 * @param entitlements - All active entitlements for the principal
 * @returns CASL AppAbility instance for permission checks
 */
export const defineAbilityFor = (
  principalId: string,
  entitlements: Entitlement[]
): AppAbility => {
  const { can, build } = new AbilityBuilder(createMongoAbility);

  // Collect all actions from all entitlements' policies
  const allActions: string[] = [];
  for (const entitlement of entitlements) {
    allActions.push(...entitlement.policy.actions);
  }

  // Deduplicate actions by string value
  const uniqueActions = [...new Set(allActions)];

  // Build CASL rules from each unique action
  for (const actionString of uniqueActions) {
    const parseResult = parseAction(actionString);

    if (!parseResult.success) {
      // Skip invalid action strings (should never happen with validated data)
      continue;
    }

    const { resource, action, scope } = parseResult.value;

    switch (scope) {
      case 'all':
        // Unrestricted access to all resources of this type
        can(action, resource);
        break;

      case 'team':
        // Access scoped to resources within tenant contexts
        // For each entitlement, add a CASL rule with tenantId condition
        for (const entitlement of entitlements) {
          // Only add tenant-scoped rules for entitlements that have this action
          if (entitlement.policy.actions.includes(actionString)) {
            if (entitlement.tenantId) {
              can(action, resource, { tenantId: entitlement.tenantId });
            }
          }
        }
        break;

      case 'own':
        // Access scoped to resources owned by this principal
        can(action, resource, { principalId });
        break;

      default:
        // Unknown scope — skip
        break;
    }
  }

  return build();
};

/**
 * Helper function to check a specific permission against a principal's entitlements.
 *
 * This is a convenience wrapper that builds the ability and performs a single check.
 * For multiple checks, use `defineAbilityFor` once and reuse the ability object.
 *
 * @param principalId - The principal's unique identifier
 * @param entitlements - All active entitlements for the principal
 * @param requiredAction - The action string to check (e.g., "campaigns:update:team")
 * @param resource - Optional resource attributes for condition matching
 * @returns true if permission is granted, false otherwise
 */
export const checkPermission = (
  principalId: string,
  entitlements: Entitlement[],
  requiredAction: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resource?: any
): boolean => {
  const ability = defineAbilityFor(principalId, entitlements);

  const parseResult = parseAction(requiredAction);
  if (!parseResult.success) {
    return false;
  }

  const { resource: resourceType, action } = parseResult.value;

  return ability.can(action, resourceType, resource);
};
