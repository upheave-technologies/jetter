// =============================================================================
// Identity Module — Principals Table
// =============================================================================
// A Principal is any actor that can be authenticated and authorized within the
// system. Principals are the foundational identity entity — every Credential,
// Session, and Membership references a Principal by soft link.
//
// Design decisions:
//   - id uses cuid2 for globally unique, collision-resistant identifiers.
//   - email has a partial unique index WHERE deletedAt IS NULL (Zombie Shield)
//     so that soft-deleted Principals do not block email reuse.
//   - metadata stores arbitrary JSON (e.g., avatar URL, locale preferences)
//     without requiring schema migrations for optional profile fields.
//   - No foreign keys exist in this table. Other modules reference principalId
//     as a soft link per the Axiom of Data Sovereignty.
//   - Indexes on type, status, and deletedAt match the expected query patterns
//     in the repository layer (list by type, filter active, Zombie Shield).
// =============================================================================

import { pgTable, text, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { isNull } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';

import { identityPrincipalType, identityPrincipalStatus } from './enums';

export const identityPrincipals = pgTable(
  'identity_principals',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    type: identityPrincipalType('type').notNull(),

    status: identityPrincipalStatus('status').notNull().default('active'),

    name: text('name').notNull(),

    email: text('email'),

    // Arbitrary profile metadata (avatar, locale, preferences, etc.)
    metadata: jsonb('metadata'),

    // Soft delete: NULL means active, timestamp means soft-deleted
    deletedAt: timestamp('deleted_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Zombie Shield: only one active Principal per email address
    uniqueIndex('identity_principals_email_unique_active')
      .on(table.email)
      .where(isNull(table.deletedAt)),

    // Lookup indexes matching repository query patterns
    index('identity_principals_type_idx').on(table.type),
    index('identity_principals_status_idx').on(table.status),
    index('identity_principals_deleted_at_idx').on(table.deletedAt),
  ],
);
