// =============================================================================
// Notifications Module — Notifications Table
// =============================================================================
// A Notification is an event-driven message delivered to a Principal through
// one or more channels. Each row represents a single notification instance.
//
// Design decisions:
//   - id uses cuid2 for globally unique, collision-resistant identifiers.
//   - principalId is a soft link (plain text, NO foreign key) per the Axiom
//     of Data Sovereignty. The identity module owns Principal lifecycle.
//   - type is an opaque text string, not a pgEnum. This allows new notification
//     types to be introduced without schema migrations. Convention is
//     dot-delimited (e.g., "campaign.approved", "billing.invoice.created").
//   - urgency uses a pgEnum because the value set is stable and drives query
//     patterns (urgent-first feed ordering).
//   - content is a JSONB column storing { title, body, actionUrl?, context? }.
//     This avoids schema migrations when content shape evolves.
//   - channels is a text array declaring delivery intents (e.g., ['in_app', 'email']).
//     Actual delivery is handled by channel adapters, not the schema.
//   - Composite indexes on (principalId, read, createdAt) and
//     (principalId, urgency, createdAt) match the two primary feed queries:
//     unread-first and urgent-first.
//   - deletedAt supports the Zombie Shield (all reads filter deletedAt IS NULL)
//     and deferred deletion by the Sweeper.
// =============================================================================

import { pgTable, text, timestamp, jsonb, boolean, index } from 'drizzle-orm/pg-core';
import { createId } from '@paralleldrive/cuid2';

import { notificationsUrgency } from './enums';

export const notificationsNotifications = pgTable(
  'notifications_notifications',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    // Soft link to identity_principals — NO foreign key constraint
    principalId: text('principal_id').notNull(),

    // Opaque notification type (e.g., "campaign.approved", "billing.payment.failed")
    type: text('type').notNull(),

    urgency: notificationsUrgency('urgency').notNull(),

    // Structured content: { title: string, body: string, actionUrl?: string, context?: Record<string, unknown> }
    content: jsonb('content').notNull(),

    // Declared delivery channel intents (e.g., ['in_app', 'email', 'push'])
    channels: text('channels').array().notNull(),

    read: boolean('read').notNull().default(false),

    readAt: timestamp('read_at', { withTimezone: true }),

    // Arbitrary extension metadata (e.g., source system, correlation IDs)
    metadata: jsonb('metadata'),

    // Soft delete: NULL means active, timestamp means soft-deleted (Zombie Shield)
    deletedAt: timestamp('deleted_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Unread feed: WHERE principalId = ? AND read = false ORDER BY createdAt DESC
    index('notifications_notifications_principal_read_created_idx')
      .on(table.principalId, table.read, table.createdAt),

    // Urgent-first feed: WHERE principalId = ? ORDER BY urgency, createdAt DESC
    index('notifications_notifications_principal_urgency_created_idx')
      .on(table.principalId, table.urgency, table.createdAt),

    // Zombie Shield filtering: WHERE deletedAt IS NULL
    index('notifications_notifications_deleted_at_idx')
      .on(table.deletedAt),

    // TTL cleanup by sweeper: WHERE createdAt < ?
    index('notifications_notifications_created_at_idx')
      .on(table.createdAt),
  ],
);
