// =============================================================================
// Domain — Action (Permission String) Validation
// =============================================================================
// Actions follow the format: "resource:action:scope"
//   - Resources: campaigns, users, organizations, profiles (application-defined)
//   - Actions: create, read, update, delete, assign, manage
//   - Scopes: own, team, all
//   - Example: "campaigns:create:team", "users:read:all"
//
// This module provides pure functions for parsing and validating action strings.
// Adapted from reference code: domain/permission.ts
// =============================================================================

import { Result } from '../../../shared/lib/result';

export type ActionParts = {
  resource: string;
  action: string;
  scope: string;
};

// =============================================================================
// Pure Validation Functions
// =============================================================================

/**
 * Parses an action string into its component parts.
 * Format: "resource:action:scope"
 */
export const parseAction = (actionString: string): Result<ActionParts, Error> => {
  const parts = actionString.split(':');

  if (parts.length !== 3) {
    return {
      success: false,
      error: new Error('Action must be in format resource:action:scope')
    };
  }

  const [resource, action, scope] = parts;

  if (!resource || !action || !scope) {
    return {
      success: false,
      error: new Error('Action parts cannot be empty')
    };
  }

  return {
    success: true,
    value: { resource, action, scope }
  };
};

/**
 * Validates that a scope is one of the allowed values.
 * Valid scopes: own, team, all
 */
export const validateActionScope = (scope: string): Result<string, Error> => {
  const validScopes = ['own', 'team', 'all'];

  if (!validScopes.includes(scope)) {
    return {
      success: false,
      error: new Error(`Scope must be one of: ${validScopes.join(', ')}`)
    };
  }

  return { success: true, value: scope };
};

/**
 * Validates a complete action string.
 * Combines parsing and scope validation.
 */
export const createAction = (actionString: string): Result<string, Error> => {
  // Parse action format
  const parseResult = parseAction(actionString);
  if (!parseResult.success) {
    return parseResult;
  }

  // Validate scope
  const scopeResult = validateActionScope(parseResult.value.scope);
  if (!scopeResult.success) {
    return scopeResult;
  }

  return {
    success: true,
    value: actionString
  };
};
