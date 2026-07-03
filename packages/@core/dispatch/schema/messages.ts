// =============================================================================
// Dispatch Module — Messages Table
// =============================================================================
// A Message is the fundamental communication unit flowing through a channel in
// either direction (inbound or outbound). Each row represents a single message
// on a single channel with independent status, retry tracking, and timestamps.
//
// Design decisions:
//   - id uses cuid2 for globally unique, collision-resistant identifiers.
//   - direction + status use PostgreSQL enums for type safety and storage
//     efficiency. A single status enum serves both directions; the direction
//     field disambiguates which subset of statuses applies.
//   - channel is an opaque text string. The core module does not constrain
//     which channels exist — adapters are registered at the application level.
//   - principalId is a soft link to identity_principals. Optional because not
//     all external parties are known Nucleus principals.
//   - threadId is an intra-module soft link to dispatch_threads. Optional
//     because one-off messages (e.g., notifications) do not require threading.
//     Defined as an ORM relation in relations.ts, NOT as a SQL foreign key,
//     to keep tables independently queryable on the batch-processing path.
//   - replyToMessageId is a soft link to another dispatch_messages record.
//     No FK constraint — messages may reference purged records after Sweeper
//     cleanup without causing integrity violations.
//   - sourceType + sourceId form a polymorphic soft link to the originating
//     entity (e.g., sourceType="notification", sourceId=<notification_id>).
//   - payload is a jsonb column storing the structured message content:
//     { title?, body, actionUrl?, context?, rawPayload? }
//   - providerResponse stores the raw response from the channel adapter after
//     delivery attempt, enabling debugging without additional logging.
//   - No deletedAt column. Message records are operational communication logs,
//     not user-facing entities. Cleaned by age-based hard-delete via Sweeper.
//   - No cross-module foreign keys per the Axiom of Data Sovereignty.
//   - Six indexes match the query patterns defined in the RFC:
//     1. Batch processing (status + direction + channel + createdAt)
//     2. Conversation view (threadId + createdAt)
//     3. Source entity lookup (sourceId)
//     4. Principal communication history (principalId + direction + createdAt)
//     5. Thread resolution by external party (externalAddress + channel)
//     6. TTL cleanup by Sweeper (createdAt)
// =============================================================================

import { pgTable, text, timestamp, jsonb, integer, index } from 'drizzle-orm/pg-core';
import { createId } from '@paralleldrive/cuid2';

import { dispatchMessageDirection, dispatchMessageStatus } from './enums';

export const dispatchMessages = pgTable(
  'dispatch_messages',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    direction: dispatchMessageDirection('direction').notNull(),

    // Opaque channel identifier (e.g., "email", "webhook", "push", "slack")
    channel: text('channel').notNull(),

    // Soft link to identity_principals — optional, not all parties are known
    principalId: text('principal_id'),

    // Channel-specific identifier of the external party
    externalAddress: text('external_address').notNull(),

    // Intra-module soft link to dispatch_threads — optional for one-off messages
    threadId: text('thread_id'),

    // Soft link to another dispatch_messages record for reply chains
    replyToMessageId: text('reply_to_message_id'),

    // Polymorphic soft link to originating entity (e.g., notification, campaign)
    sourceType: text('source_type'),
    sourceId: text('source_id'),

    // Structured message content: { title?, body, actionUrl?, context?, rawPayload? }
    payload: jsonb('payload').notNull(),

    status: dispatchMessageStatus('status').notNull().default('pending'),

    retryCount: integer('retry_count').notNull().default(0),
    maxRetries: integer('max_retries').notNull().default(3),

    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),

    // Raw response from the channel adapter after delivery attempt
    providerResponse: jsonb('provider_response'),

    // Inbound-specific timestamps
    receivedAt: timestamp('received_at', { withTimezone: true }),
    processedAt: timestamp('processed_at', { withTimezone: true }),

    // Arbitrary metadata for extensibility
    metadata: jsonb('metadata'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // 1. Batch processing: find pending outbound or unprocessed inbound by channel
    index('dispatch_messages_status_direction_channel_created_at_idx').on(
      table.status,
      table.direction,
      table.channel,
      table.createdAt,
    ),

    // 2. Conversation view: all messages in a thread chronologically
    index('dispatch_messages_thread_id_created_at_idx').on(
      table.threadId,
      table.createdAt,
    ),

    // 3. Source entity lookup: find messages for a given notification or originating entity
    index('dispatch_messages_source_id_idx').on(table.sourceId),

    // 4. Principal communication history: all messages for a principal by direction
    index('dispatch_messages_principal_id_direction_created_at_idx').on(
      table.principalId,
      table.direction,
      table.createdAt,
    ),

    // 5. Thread resolution: find messages by external party address and channel
    index('dispatch_messages_external_address_channel_idx').on(
      table.externalAddress,
      table.channel,
    ),

    // 6. TTL cleanup: Sweeper purges records older than retention threshold
    index('dispatch_messages_created_at_idx').on(table.createdAt),
  ],
);
