// =============================================================================
// IAM Module — Drizzle Enums
// =============================================================================
// PostgreSQL enum types for the IAM module.
//
// PolicyScope determines whether a Policy applies platform-wide or within a
// Tenant boundary:
//   - PLATFORM: Applies regardless of Tenant context
//   - TENANT: Applies only within a specific Tenant
// =============================================================================

import { pgEnum } from 'drizzle-orm/pg-core';

export const policyScope = pgEnum('iam_policy_scope', ['PLATFORM', 'TENANT']);
