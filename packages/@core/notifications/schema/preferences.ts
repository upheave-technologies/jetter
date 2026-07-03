// =============================================================================
// Notifications Module — Preferences Table
// =============================================================================
// A Preferences record stores a Principal's notification delivery settings.
// There is exactly one preferences record per Principal (enforced by unique
// constraint on principalId).
//
// Design decisions:
//   - principalId is a soft link (plain text, NO foreign key) per the Axiom
//     of Data Sovereignty.
//   - preferences is a JSONB column storing the full preferences record.
//     This allows the preference shape to evolve without schema migrations
//     (e.g., adding new channel types, new urgency overrides).
//   - NO deletedAt column. Per RFC design decision: preferences are not
//     user-facing entities. Hard-delete by the Sweeper is acceptable since
//     preferences have no audit trail requirement.
//   - Unique constraint on principalId ensures one record per Principal,
//     enabling upsert semantics in the repository layer.
// =============================================================================

import { pgTable, text, timestamp, jsonb, uniqueIndex } from 'drizzle-orm/pg-core';
import { createId } from '@paralleldrive/cuid2';

export const notificationsPreferences = pgTable(
  'notifications_preferences',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    // Soft link to identity_principals — NO foreign key constraint
    principalId: text('principal_id').notNull(),

    // Structured preferences: channel settings, urgency overrides, quiet hours, etc.
    preferences: jsonb('preferences').notNull(),

    // Arbitrary extension metadata
    metadata: jsonb('metadata'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // One preference record per Principal
    uniqueIndex('notifications_preferences_principal_id_unique')
      .on(table.principalId),
  ],
);
