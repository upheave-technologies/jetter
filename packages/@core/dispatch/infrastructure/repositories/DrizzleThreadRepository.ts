// =============================================================================
// Infrastructure — Drizzle Thread Repository
// =============================================================================
// Concrete implementation of IThreadRepository using Drizzle ORM.
//
// This repository implements all persistence operations for the Thread entity:
//   - No Zombie Shield (isNull deletedAt) needed: dispatch_threads has no
//     deletedAt column — threads use a status-based lifecycle instead.
//   - findByExternalAddress is the CRITICAL inbound thread resolution query:
//     it hits the composite index (externalAddress + channel + status).
//   - findByIdWithMessages fetches the thread and its paginated message history
//     in two sequential queries (thread lookup + message page).
//   - update() sets all mutable fields atomically; the caller bumps updatedAt.
//   - Mapper functions handle undefined ↔ null conversion at the DB boundary.
//
// Factory pattern for dependency injection:
//   const repository = makeThreadRepository(db);
//   await repository.findByExternalAddress('email', 'user@example.com', 'active');
// =============================================================================

import { eq, and, gt, asc } from 'drizzle-orm';
import { dispatchThreads } from '../../schema/threads';
import { dispatchMessages } from '../../schema/messages';
import { Thread, ThreadStatus } from '../../domain/thread';
import { Message, MessageDirection, MessagePayload, MessageStatus } from '../../domain/message';
import { IThreadRepository } from '../../domain/threadRepository';
import { DispatchDatabase } from './DrizzleMessageRepository';

// =============================================================================
// Repository Factory
// =============================================================================

/**
 * Factory function that creates a Thread repository instance.
 *
 * @param db - Drizzle database instance with Dispatch schema
 * @returns IThreadRepository implementation
 */
export const makeThreadRepository = (db: DispatchDatabase): IThreadRepository => ({
  /**
   * Persist a new Thread to storage.
   * Converts undefined domain values to null for database compatibility.
   */
  async save(thread: Thread): Promise<void> {
    await db.insert(dispatchThreads).values(mapToRow(thread));
  },

  /**
   * Find a Thread by its unique ID.
   * No Zombie Shield needed — dispatch_threads has no deletedAt column.
   */
  async findById(id: string): Promise<Thread | null> {
    const result = await db
      .select()
      .from(dispatchThreads)
      .where(eq(dispatchThreads.id, id))
      .limit(1);

    if (result.length === 0) return null;
    return mapToThread(result[0]);
  },

  /**
   * Find a Thread by (channel, externalAddress, status).
   * CRITICAL PATH for inbound thread resolution — hits the composite index
   * (dispatch_threads_external_address_channel_status_idx).
   */
  async findByExternalAddress(
    channel: string,
    externalAddress: string,
    status: ThreadStatus,
  ): Promise<Thread | null> {
    const result = await db
      .select()
      .from(dispatchThreads)
      .where(
        and(
          eq(dispatchThreads.channel, channel),
          eq(dispatchThreads.externalAddress, externalAddress),
          eq(dispatchThreads.status, status),
        ),
      )
      .limit(1);

    if (result.length === 0) return null;
    return mapToThread(result[0]);
  },

  /**
   * Find a Thread for a known Principal on a given channel with the given status.
   * Hits the composite index (dispatch_threads_principal_id_channel_status_idx).
   */
  async findByPrincipal(
    principalId: string,
    channel: string,
    status: ThreadStatus,
  ): Promise<Thread | null> {
    const result = await db
      .select()
      .from(dispatchThreads)
      .where(
        and(
          eq(dispatchThreads.principalId, principalId),
          eq(dispatchThreads.channel, channel),
          eq(dispatchThreads.status, status),
        ),
      )
      .limit(1);

    if (result.length === 0) return null;
    return mapToThread(result[0]);
  },

  /**
   * Find a Thread by (sourceType, sourceId) of the originating business object.
   * Hits the dispatch_threads_source_id_idx index.
   */
  async findBySource(sourceType: string, sourceId: string): Promise<Thread | null> {
    const result = await db
      .select()
      .from(dispatchThreads)
      .where(
        and(
          eq(dispatchThreads.sourceType, sourceType),
          eq(dispatchThreads.sourceId, sourceId),
        ),
      )
      .limit(1);

    if (result.length === 0) return null;
    return mapToThread(result[0]);
  },

  /**
   * Update all mutable fields of an existing Thread in storage.
   * The caller is responsible for bumping updatedAt before passing the entity.
   * Immutable fields (id, channel, createdAt) are never overwritten.
   */
  async update(thread: Thread): Promise<void> {
    await db
      .update(dispatchThreads)
      .set({
        principalId: thread.principalId ?? null,
        externalAddress: thread.externalAddress,
        sourceType: thread.sourceType ?? null,
        sourceId: thread.sourceId ?? null,
        status: thread.status,
        metadata: (thread.metadata as Record<string, unknown> | undefined) ?? null,
        updatedAt: thread.updatedAt,
      })
      .where(eq(dispatchThreads.id, thread.id));
  },

  /**
   * Load a Thread and its associated Messages in two sequential queries.
   * Messages are paginated using cursor-based pagination on createdAt to avoid
   * N-row scans on large threads.
   *
   * Returns null if the thread does not exist.
   * Default message limit: 50.
   */
  async findByIdWithMessages(
    threadId: string,
    cursor?: string,
    limit = 50,
  ): Promise<{ thread: Thread; messages: Message[] } | null> {
    // Step 1: fetch the thread
    const threadResult = await db
      .select()
      .from(dispatchThreads)
      .where(eq(dispatchThreads.id, threadId))
      .limit(1);

    if (threadResult.length === 0) return null;

    const thread = mapToThread(threadResult[0]);

    // Step 2: fetch messages with optional cursor pagination
    let messages: Message[];

    if (cursor) {
      const cursorResult = await db
        .select({ createdAt: dispatchMessages.createdAt })
        .from(dispatchMessages)
        .where(eq(dispatchMessages.id, cursor))
        .limit(1);

      if (cursorResult.length === 0) {
        // Cursor message not found — return thread with empty message page
        return { thread, messages: [] };
      }

      const cursorCreatedAt = cursorResult[0].createdAt;

      const messageRows = await db
        .select()
        .from(dispatchMessages)
        .where(
          and(
            eq(dispatchMessages.threadId, threadId),
            gt(dispatchMessages.createdAt, cursorCreatedAt),
          ),
        )
        .orderBy(asc(dispatchMessages.createdAt))
        .limit(limit);

      messages = messageRows.map(mapToMessage);
    } else {
      const messageRows = await db
        .select()
        .from(dispatchMessages)
        .where(eq(dispatchMessages.threadId, threadId))
        .orderBy(asc(dispatchMessages.createdAt))
        .limit(limit);

      messages = messageRows.map(mapToMessage);
    }

    return { thread, messages };
  },
});

// =============================================================================
// Internal Mapping Functions
// =============================================================================

/**
 * Maps a domain Thread to a DB row shape for INSERT operations.
 * Converts undefined domain values to null for nullable DB columns.
 */
function mapToRow(thread: Thread): typeof dispatchThreads.$inferInsert {
  return {
    id: thread.id,
    channel: thread.channel,
    principalId: thread.principalId ?? null,
    externalAddress: thread.externalAddress,
    sourceType: thread.sourceType ?? null,
    sourceId: thread.sourceId ?? null,
    status: thread.status,
    metadata: (thread.metadata as Record<string, unknown> | undefined) ?? null,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}

/**
 * Maps a Drizzle query result row to the domain Thread type.
 *
 * Handles type conversions:
 *   - status (enum)              → cast to ThreadStatus domain type
 *   - metadata (jsonb|null)      → cast to Record<string, unknown>, null → undefined
 *   - All nullable text fields   → null → undefined
 */
function mapToThread(row: typeof dispatchThreads.$inferSelect): Thread {
  return {
    id: row.id,
    channel: row.channel,
    principalId: row.principalId ?? undefined,
    externalAddress: row.externalAddress,
    sourceType: row.sourceType ?? undefined,
    sourceId: row.sourceId ?? undefined,
    status: row.status as ThreadStatus,
    metadata: (row.metadata as Record<string, unknown> | null) ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Maps a Drizzle query result row to the domain Message type.
 * Duplicated here (also in DrizzleMessageRepository) to avoid cross-repository
 * imports — this keeps each repository file independently deployable.
 *
 * Handles type conversions:
 *   - direction (enum)             → cast to MessageDirection domain type
 *   - status (enum)                → cast to MessageStatus domain type
 *   - payload (jsonb)              → cast to MessagePayload
 *   - providerResponse (jsonb|null)→ cast to Record<string, unknown>, null → undefined
 *   - metadata (jsonb|null)        → cast to Record<string, unknown>, null → undefined
 *   - All nullable text fields     → null → undefined
 *   - All nullable timestamps      → null → undefined
 */
function mapToMessage(row: typeof dispatchMessages.$inferSelect): Message {
  return {
    id: row.id,
    direction: row.direction as MessageDirection,
    channel: row.channel,
    principalId: row.principalId ?? undefined,
    externalAddress: row.externalAddress,
    threadId: row.threadId ?? undefined,
    replyToMessageId: row.replyToMessageId ?? undefined,
    sourceType: row.sourceType ?? undefined,
    sourceId: row.sourceId ?? undefined,
    payload: row.payload as MessagePayload,
    status: row.status as MessageStatus,
    retryCount: row.retryCount,
    maxRetries: row.maxRetries,
    lastAttemptAt: row.lastAttemptAt ?? undefined,
    deliveredAt: row.deliveredAt ?? undefined,
    providerResponse: (row.providerResponse as Record<string, unknown> | null) ?? undefined,
    receivedAt: row.receivedAt ?? undefined,
    processedAt: row.processedAt ?? undefined,
    metadata: (row.metadata as Record<string, unknown> | null) ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
