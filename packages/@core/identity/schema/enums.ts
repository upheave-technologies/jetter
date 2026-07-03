// =============================================================================
// Identity Module — Drizzle Enums
// =============================================================================
// PostgreSQL enum types for the Identity module.
//
// PrincipalType represents the kind of actor that can exist in the system:
//   - human:  A real person (end-user, admin, etc.)
//   - agent:  An autonomous AI agent acting on behalf of a human or system
//   - system: An internal service or background process
//
// PrincipalStatus represents the lifecycle state of a Principal:
//   - active:      The Principal can authenticate and perform actions
//   - suspended:   Temporarily blocked — can be reactivated
//   - deactivated: Permanently disabled — cannot be reactivated
// =============================================================================

import { pgEnum } from 'drizzle-orm/pg-core';

export const identityPrincipalType = pgEnum('identity_principal_type', ['human', 'agent', 'system']);

export const identityPrincipalStatus = pgEnum('identity_principal_status', ['active', 'suspended', 'deactivated']);
