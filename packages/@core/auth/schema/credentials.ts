// =============================================================================
// Auth Module — Credentials Table
// =============================================================================
// A Credential is the proof of identity for a Principal. One Principal may hold
// multiple Credentials of different types (e.g., a password AND an OAuth link).
//
// Design decisions:
//   - principalId is a SOFT LINK (plain text) to the Identity module. No foreign
//     key is created across module boundaries per the Axiom of Data Sovereignty.
//   - secretHash stores the Argon2id hash for passwords, a hashed API key for
//     api_key type, and an opaque token for oauth type if needed.
//   - keyPrefix enables O(1) lookup of API keys without exposing the full secret.
//     The prefix is the first ~8 chars of the raw key, stored in plain text.
//   - provider / providerAccountId are used exclusively for the oauth type.
//   - Partial unique index on (principalId, type) WHERE deleted_at IS NULL AND
//     type = 'password' enforces that a Principal can have at most one active
//     password credential at a time.
//   - Partial unique index on (principalId, provider, providerAccountId) WHERE
//     deleted_at IS NULL enforces uniqueness of an OAuth account link per Principal.
//   - Indexes on principalId, type, expiresAt, deletedAt, and keyPrefix match
//     the actual query patterns in the repository layer.
// =============================================================================

import { pgTable, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { isNull, sql } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';

import { authCredentialType } from './enums';

export const credentials = pgTable(
  'auth_credentials',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    // Soft link to the Identity module — intentionally no FK constraint
    principalId: text('principal_id').notNull(),

    type: authCredentialType('type').notNull(),

    // OAuth-specific fields: null for non-oauth credential types
    provider: text('provider'),
    providerAccountId: text('provider_account_id'),

    // Stores Argon2id hash for passwords, hashed API key for api_key type
    secretHash: text('secret_hash').notNull(),

    // Plain-text prefix of the raw API key for O(1) bucket lookup
    keyPrefix: text('key_prefix'),

    // Nullable timestamps for tracking and expiry
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),

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
    index('auth_credentials_principal_id_idx').on(table.principalId),
    index('auth_credentials_type_idx').on(table.type),
    index('auth_credentials_expires_at_idx').on(table.expiresAt),
    index('auth_credentials_deleted_at_idx').on(table.deletedAt),
    index('auth_credentials_key_prefix_idx').on(table.keyPrefix),

    // Partial unique: A Principal can have at most ONE active password credential.
    uniqueIndex('auth_credentials_principal_password_unique_active')
      .on(table.principalId, table.type)
      .where(sql`${table.deletedAt} IS NULL AND ${table.type} = 'password'`),

    // Partial unique: A Principal can link a given OAuth account only once.
    uniqueIndex('auth_credentials_principal_provider_unique_active')
      .on(table.principalId, table.provider, table.providerAccountId)
      .where(isNull(table.deletedAt)),
  ],
);
