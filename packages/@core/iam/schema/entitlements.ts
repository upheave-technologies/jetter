// =============================================================================
// IAM Module — Entitlements Table
// =============================================================================
// The assignment of a Policy to a Principal within an optional Tenant context.
// Entitlements answer: "Principal X has Policy Y in Tenant Z."
//
// Cross-module references (SOFT LINKS -- plain text, NO foreign keys):
//   - principal_id: References a Principal in the Identity module (core_identity).
//     Could be a Human, AI Agent, or System worker.
//   - tenant_id: References a Tenant in the Tenancy module (core_tenancy).
//     NULL means this is a PLATFORM-scoped entitlement (no Tenant boundary).
//   - granted_by_principal_id: The Principal who granted this entitlement.
//     Critical for auditing AI agent provisioning and delegation chains.
//
// Intra-module reference (HARD FK -- allowed within same module):
//   - policy_id: References Policy.id in this module. Uses onDelete: 'restrict'
//     to prevent deleting a Policy that has active Entitlements.
//
// Design decisions:
//   - Soft links use plain text columns with NO FK constraints. This follows the
//     Nucleus module-boundary philosophy: modules do not create cross-module FKs.
//   - Partial unique index on (principal_id, tenant_id, policy_id) WHERE
//     deleted_at IS NULL ensures a Principal cannot be assigned the same Policy
//     in the same Tenant context twice among active records.
//   - Individual column indexes support the repository query patterns:
//     findByPrincipalAndTenant, findAllByPrincipal, softDeleteByPrincipalAndPolicy
// =============================================================================

import { pgTable, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { isNull } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';

import { policies } from './policies';

export const entitlements = pgTable(
  'iam_entitlements',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    // SOFT LINK to core_identity.principals -- NO FK.
    // This is a cross-module reference. The Identity module owns this entity.
    principalId: text('principal_id').notNull(),

    // SOFT LINK to core_tenancy.tenants -- NO FK. NULL = PLATFORM scope.
    // This is a cross-module reference. The Tenancy module owns this entity.
    tenantId: text('tenant_id'),

    // Intra-module FK to policies.id. Uses restrict to prevent orphaned entitlements.
    policyId: text('policy_id')
      .notNull()
      .references(() => policies.id, { onDelete: 'restrict' }),

    // SOFT LINK to core_identity.principals -- NO FK.
    // The Principal who granted this entitlement. Critical for audit trails.
    grantedByPrincipalId: text('granted_by_principal_id').notNull(),

    // Soft delete: NULL means active, timestamp means soft-deleted
    deletedAt: timestamp('deleted_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Composite index supporting the primary query pattern: findByPrincipalAndTenant
    index('iam_entitlements_principal_tenant_policy_idx').on(
      table.principalId,
      table.tenantId,
      table.policyId,
    ),

    // Individual column indexes for filtered queries
    index('iam_entitlements_principal_id_idx').on(table.principalId),
    index('iam_entitlements_tenant_id_idx').on(table.tenantId),
    index('iam_entitlements_policy_id_idx').on(table.policyId),
    index('iam_entitlements_granted_by_idx').on(table.grantedByPrincipalId),
    index('iam_entitlements_deleted_at_idx').on(table.deletedAt),

    // Partial unique: A Principal can only be assigned a given Policy in a given
    // Tenant context once among active (non-deleted) records.
    // Drizzle supports this natively -- no raw SQL migration needed.
    uniqueIndex('iam_entitlements_principal_tenant_policy_unique_active')
      .on(table.principalId, table.tenantId, table.policyId)
      .where(isNull(table.deletedAt)),
  ],
);
