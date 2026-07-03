// =============================================================================
// IAM Module — Policies Table
// =============================================================================
// The agnostic equivalent of "Roles" -- a named, reusable bundle of actions.
// Policies define WHAT can be done. They are assigned to Principals via
// Entitlements.
//
// Actions follow the format: "resource:action:scope"
//   - Actions: create, read, update, delete, assign, manage
//   - Resources: campaigns, users, organizations, profiles (application-defined)
//   - Scopes: own, team, all
//   - Example: "campaigns:create:team", "users:read:all"
//
// Policies are additive -- a Principal's effective permissions are the union
// of all actions from all their active Entitlements.
//
// Design decisions:
//   - actions stored as JSONB typed as string[] for PostgreSQL-native querying
//   - Partial unique index on name WHERE deleted_at IS NULL ensures soft-deleted
//     records do not block reuse of policy names (Drizzle supports this natively)
//   - Indexes on name, scope, and deleted_at match actual query patterns used
//     by the repository layer (findByName, findByScope, zombie shield filtering)
// =============================================================================

import { pgTable, text, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { isNull } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';

import { policyScope } from './enums';

export const policies = pgTable(
  'iam_policies',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    name: text('name').notNull(),

    scope: policyScope('scope').notNull(),

    // JSON array of action strings, e.g. ["campaigns:create:team", "users:read:all"]
    actions: jsonb('actions').notNull().$type<string[]>(),

    description: text('description'),

    // Soft delete: NULL means active, timestamp means soft-deleted
    deletedAt: timestamp('deleted_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Lookup indexes matching repository query patterns
    index('iam_policies_name_idx').on(table.name),
    index('iam_policies_scope_idx').on(table.scope),
    index('iam_policies_deleted_at_idx').on(table.deletedAt),

    // Partial unique: Policy names must be unique among active (non-deleted) records.
    // This is a major advantage over Prisma -- Drizzle can express partial unique
    // indexes natively, no raw SQL migration needed.
    uniqueIndex('iam_policies_name_unique_active')
      .on(table.name)
      .where(isNull(table.deletedAt)),
  ],
);
