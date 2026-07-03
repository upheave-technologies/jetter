// =============================================================================
// Dispatch Module — Drizzle Relations
// =============================================================================
// Defines ORM-level relations for the Dispatch module's schema.
//
// Intra-module relations:
//   - dispatchMessages has an optional `thread` relation to dispatchThreads
//     via the threadId soft link. This is an ORM-level relation only — no SQL
//     foreign key constraint is created. Threading is optional (one-off
//     messages have no thread), and keeping it as a soft link preserves
//     independent queryability on the batch-processing path.
//   - dispatchThreads has a `messages` relation (one-to-many) back to
//     dispatchMessages for conversation view queries.
//
// Cross-module references (principalId, sourceId, replyToMessageId) are soft
// links (plain text IDs) and intentionally have NO relation definitions here.
// Cross-module ORM relations would violate the Axiom of Isolation.
// =============================================================================

import { relations } from 'drizzle-orm';

import { dispatchMessages } from './messages';
import { dispatchThreads } from './threads';

export const dispatchMessagesRelations = relations(dispatchMessages, ({ one }) => ({
  thread: one(dispatchThreads, {
    fields: [dispatchMessages.threadId],
    references: [dispatchThreads.id],
  }),
}));

export const dispatchThreadsRelations = relations(dispatchThreads, ({ many }) => ({
  messages: many(dispatchMessages),
}));
