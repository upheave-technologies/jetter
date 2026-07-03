// =============================================================================
// Audit Module — AuditError factory
// =============================================================================
// Provides a convenience factory for constructing AuditError objects.
// The type itself lives in domain/types.ts; this file wraps construction
// so callers can create errors with a single expression.
// =============================================================================

import type { AuditError } from '../domain/types';

/**
 * Creates an AuditError object.
 *
 * Usage:
 *   return { success: false, error: auditErr('VALIDATION_ERROR', 'Missing entity type') };
 */
export function auditErr(
  code: AuditError['code'],
  message: string,
  details?: unknown,
): AuditError {
  return details !== undefined
    ? { code, message, details }
    : { code, message };
}
