// =============================================================================
// Domain — Message Repository Interface
// =============================================================================
// This is the CONTRACT for Message persistence operations.
// The domain layer defines WHAT it needs; the infrastructure layer provides
// the concrete Drizzle implementation (DrizzleMessageRepository).
//
// Query responsibilities:
//   - findPendingOutbound:    retrieves outbound messages in 'pending' status for
//                             a specific channel, ready for the dispatch worker
//   - findUnprocessedInbound: retrieves inbound messages in 'received' status,
//                             ready for the inbound router worker
//   - findFailedForRetry:     retrieves messages in 'failed' status where
//                             retryCount < maxRetries, for the retry worker
//   - findByThread:           retrieves messages belonging to a thread, ordered
//                             by createdAt, supporting cursor-based pagination
//   - updateStatus:           targeted partial update for status-change operations;
//                             avoids loading and re-saving the full entity
//   - updateStatusBulk:       batched version of updateStatus for worker batch
//                             processing efficiency
//   - deleteOlderThan:        hard-deletes messages older than a given date for
//                             storage lifecycle management (archival/purge policy)
//
// Design decisions:
//   - All read methods implicitly return only non-soft-deleted records. Messages
//     do not currently use soft-delete (they use a terminal status model instead),
//     so deleteOlderThan performs a physical delete — acceptable for log-style
//     records once they exceed the retention window.
//   - limit/cursor parameters on paginated methods are optional; callers should
//     always pass explicit values in production to bound result set sizes.
//   - updateStatus accepts a Partial<Pick<...>> to allow partial updates without
//     loading the full entity first. The repository implementation is responsible
//     for also updating updatedAt.
// =============================================================================

import type { Message, MessageDirection, MessageStatus } from './message';

export type IMessageRepository = {
  /**
   * Persist a new Message to storage.
   */
  save: (message: Message) => Promise<void>;

  /**
   * Persist multiple Messages in a single batch operation.
   * Implementations should use a single database round-trip where possible.
   */
  saveBulk: (messages: Message[]) => Promise<void>;

  /**
   * Find a Message by its unique ID.
   * Returns null if not found.
   */
  findById: (id: string) => Promise<Message | null>;

  /**
   * Find outbound messages in 'pending' status for a given channel.
   * Used by the dispatch worker to pick up the next batch for sending.
   * Results are ordered by createdAt ascending (oldest first).
   */
  findPendingOutbound: (channel: string, limit: number) => Promise<Message[]>;

  /**
   * Find inbound messages in 'received' status, ready for handler routing.
   * Used by the inbound processing worker.
   * Results are ordered by createdAt ascending (oldest first).
   */
  findUnprocessedInbound: (limit: number) => Promise<Message[]>;

  /**
   * Find messages in 'failed' status that are eligible for retry
   * (retryCount < maxRetries), filtered by direction.
   * Results are ordered by lastAttemptAt ascending.
   */
  findFailedForRetry: (direction: MessageDirection, limit: number) => Promise<Message[]>;

  /**
   * Find all messages belonging to a thread, ordered by createdAt ascending.
   * Supports cursor-based pagination for large threads.
   *
   * @param threadId - the thread to query
   * @param cursor   - if provided, return only messages created after this message ID
   * @param limit    - maximum number of messages to return
   */
  findByThread: (threadId: string, cursor?: string, limit?: number) => Promise<Message[]>;

  /**
   * Apply a partial status-related update to a Message by ID.
   * The implementation must also bump updatedAt.
   * Used by workers after each delivery attempt or status transition.
   */
  updateStatus: (
    id: string,
    updates: Partial<
      Pick<Message, 'status' | 'retryCount' | 'lastAttemptAt' | 'deliveredAt' | 'processedAt' | 'providerResponse'>
    >
  ) => Promise<void>;

  /**
   * Apply partial status-related updates to multiple Messages in one batch.
   * More efficient than calling updateStatus in a loop.
   * The implementation must also bump updatedAt for each record.
   */
  updateStatusBulk: (
    updates: Array<{
      id: string;
      changes: Partial<
        Pick<Message, 'status' | 'retryCount' | 'lastAttemptAt' | 'deliveredAt' | 'processedAt' | 'providerResponse'>
      >;
    }>
  ) => Promise<void>;

  /**
   * Hard-delete all Messages with createdAt older than the given date.
   * Returns the number of records deleted.
   * Used for storage lifecycle management (retention policy enforcement).
   */
  deleteOlderThan: (date: Date) => Promise<number>;

  /**
   * Find the most recent Message where providerResponse JSONB contains
   * a field matching the given value. Supports optional filters on channel,
   * direction, and status for scoping the search.
   * Returns null if not found.
   */
  findByProviderRef: (
    field: string,
    value: string,
    filters?: { channel?: string; direction?: MessageDirection; status?: MessageStatus }
  ) => Promise<Message | null>;

  /**
   * Find the earliest sent outbound Message for a given source entity.
   * Used to locate the original message sent for a source (e.g. a campaign item)
   * so callers can retrieve its providerResponse for thread correlation.
   * Returns null if not found.
   */
  findSentBySource: (
    sourceType: string,
    sourceId: string
  ) => Promise<Message | null>;
};
