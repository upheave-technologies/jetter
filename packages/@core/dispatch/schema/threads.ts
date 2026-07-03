// =============================================================================
// Dispatch Module — Threads Table
// =============================================================================
// A Thread groups related messages into a conversation on a single channel.
// Threads enable multi-turn interactions essential for agentic back-and-forth,
// support conversations, and any scenario requiring context continuity.
//
// Design decisions:
//   - id uses cuid2 for globally unique, collision-resistant identifiers.
//   - channel + externalAddress together identify a conversation with a
//     specific external party on a specific channel.
//   - principalId is a soft link to identity_principals. Optional because
//     not all external parties are known Nucleus principals. Resolved via
//     the application-injected principalResolver function.
//   - sourceType + sourceId form a polymorphic soft link to the business
//     entity that initiated the thread (e.g., an invoice, a campaign).
//   - status controls thread lifecycle. Closed threads do not accept new
//     inbound message linkage — a new thread is created instead.
//   - No deletedAt column. Thread records are operational data cleaned by
//     age-based hard-delete via Sweeper, same lifecycle as messages.
//   - No cross-module foreign keys per the Axiom of Data Sovereignty.
//   - Three indexes match the query patterns defined in the RFC:
//     1. Active thread for principal (principalId + channel + status)
//     2. Inbound thread resolution (externalAddress + channel + status)
//     3. Source entity lookup (sourceId)
// =============================================================================

import { pgTable, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { createId } from '@paralleldrive/cuid2';

import { dispatchThreadStatus } from './enums';

export const dispatchThreads = pgTable(
  'dispatch_threads',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    // Opaque channel identifier — must match the channel on linked messages
    channel: text('channel').notNull(),

    // Soft link to identity_principals — optional
    principalId: text('principal_id'),

    // Channel-specific identifier of the external party
    externalAddress: text('external_address').notNull(),

    // Polymorphic soft link to originating business entity
    sourceType: text('source_type'),
    sourceId: text('source_id'),

    status: dispatchThreadStatus('status').notNull().default('active'),

    // Arbitrary metadata for extensibility
    metadata: jsonb('metadata'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // 1. Find active thread for a principal on a channel
    index('dispatch_threads_principal_id_channel_status_idx').on(
      table.principalId,
      table.channel,
      table.status,
    ),

    // 2. Inbound thread resolution: find active thread by external address — critical path
    index('dispatch_threads_external_address_channel_status_idx').on(
      table.externalAddress,
      table.channel,
      table.status,
    ),

    // 3. Source entity lookup: find thread for a given source entity
    index('dispatch_threads_source_id_idx').on(table.sourceId),
  ],
);
