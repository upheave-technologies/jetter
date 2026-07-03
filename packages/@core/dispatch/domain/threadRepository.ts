// =============================================================================
// Domain — Thread Repository Interface
// =============================================================================
// This is the CONTRACT for Thread persistence operations.
// The domain layer defines WHAT it needs; the infrastructure layer provides
// the concrete Drizzle implementation (DrizzleThreadRepository).
//
// Query responsibilities:
//   - findByExternalAddress: look up an existing thread for a (channel, address,
//                             status) combination — used when an inbound message
//                             arrives and we need to find or create a thread
//   - findByPrincipal:       look up an active thread for a known Principal on a
//                             channel — used for outbound send-and-thread flows
//   - findBySource:          look up a thread by the originating business object —
//                             allows application modules to find threads they created
//   - findByIdWithMessages:  convenience query that loads a thread and its message
//                             history in a single round-trip, with cursor pagination
//
// Design decisions:
//   - findByExternalAddress accepts a ThreadStatus parameter so the caller can
//     distinguish between finding an 'active' thread (to append to) and finding
//     a 'closed' thread (audit/history purposes). Searching across both statuses
//     requires two separate calls — this keeps the interface explicit.
//   - findByIdWithMessages returns null if the thread does not exist rather than
//     returning an empty message list, so the caller can distinguish "thread not
//     found" from "thread exists but has no messages".
//   - Message pagination in findByIdWithMessages uses a cursor (message ID) rather
//     than an offset to avoid the N-row-scan cost on large threads.
// =============================================================================

import type { Thread, ThreadStatus } from './thread';
import type { Message } from './message';

export type IThreadRepository = {
  /**
   * Persist a new Thread to storage.
   */
  save: (thread: Thread) => Promise<void>;

  /**
   * Find a Thread by its unique ID.
   * Returns null if not found.
   */
  findById: (id: string) => Promise<Thread | null>;

  /**
   * Find a Thread by the (channel, externalAddress, status) combination.
   * Used when an inbound message arrives to find an existing conversation
   * context before deciding whether to create a new thread.
   * Returns null if no matching thread exists.
   */
  findByExternalAddress: (
    channel: string,
    externalAddress: string,
    status: ThreadStatus
  ) => Promise<Thread | null>;

  /**
   * Find a Thread for a known Principal on a given channel with the given status.
   * Used for outbound message flows where the system initiates a conversation
   * with a Principal and wants to continue an existing thread.
   * Returns null if no matching thread exists.
   */
  findByPrincipal: (
    principalId: string,
    channel: string,
    status: ThreadStatus
  ) => Promise<Thread | null>;

  /**
   * Find a Thread by the (sourceType, sourceId) pair of the originating business object.
   * Allows application modules to retrieve threads they created without storing the
   * thread ID on their own records.
   * Returns null if no matching thread exists.
   */
  findBySource: (sourceType: string, sourceId: string) => Promise<Thread | null>;

  /**
   * Update an existing Thread in storage.
   * The caller is responsible for bumping updatedAt before passing the entity.
   */
  update: (thread: Thread) => Promise<void>;

  /**
   * Load a Thread and its associated Messages in a single query.
   * Messages are ordered by createdAt ascending.
   * Supports cursor-based pagination for large threads.
   *
   * @param threadId - the thread to load
   * @param cursor   - if provided, return only messages created after this message ID
   * @param limit    - maximum number of messages to return
   *
   * Returns null if the thread does not exist.
   */
  findByIdWithMessages: (
    threadId: string,
    cursor?: string,
    limit?: number
  ) => Promise<{ thread: Thread; messages: Message[] } | null>;
};
