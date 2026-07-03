// =============================================================================
// Dispatch Module — Drizzle Enums
// =============================================================================
// PostgreSQL enum types for the Dispatch module.
//
// MessageDirection represents the flow of a message through the system:
//   - inbound:  A message received from an external party via a channel
//   - outbound: A message sent to an external party via a channel
//
// MessageStatus represents the lifecycle state of a message. Both directions
// share a single enum; the direction field disambiguates which subset applies:
//   Outbound: pending -> processing -> sent | failed | bounced
//   Inbound:  received -> processing -> processed | failed
//
// ThreadStatus represents the lifecycle of a conversational thread:
//   - active: Thread accepts new messages
//   - closed: Thread is archived; new inbound creates a new thread
// =============================================================================

import { pgEnum } from 'drizzle-orm/pg-core';

export const dispatchMessageDirection = pgEnum('dispatch_message_direction', [
  'inbound',
  'outbound',
]);

export const dispatchMessageStatus = pgEnum('dispatch_message_status', [
  'pending',
  'processing',
  'sent',
  'failed',
  'bounced',
  'received',
  'processed',
]);

export const dispatchThreadStatus = pgEnum('dispatch_thread_status', [
  'active',
  'closed',
]);
