// =============================================================================
// IAM Module — Drizzle Relations
// =============================================================================
// Defines the ORM-level relations between IAM tables. These are used by
// Drizzle's relational query API (db.query.policies.findMany({ with: ... }))
// and do NOT create additional database constraints.
//
// Only intra-module relations are defined here. Cross-module references
// (principal_id, tenant_id, granted_by_principal_id) are soft links and
// intentionally have no relation definitions.
//
// Relations:
//   - Policy has many Entitlements (one-to-many)
//   - Entitlement belongs to one Policy (many-to-one)
// =============================================================================

import { relations } from 'drizzle-orm';

import { policies } from './policies';
import { entitlements } from './entitlements';

export const policiesRelations = relations(policies, ({ many }) => ({
  entitlements: many(entitlements),
}));

export const entitlementsRelations = relations(entitlements, ({ one }) => ({
  policy: one(policies, {
    fields: [entitlements.policyId],
    references: [policies.id],
  }),
}));
