// =============================================================================
// Infrastructure — Drizzle Message Repository
// =============================================================================
// Concrete implementation of IMessageRepository using Drizzle ORM.
//
// This repository implements all persistence operations for the Message entity:
//   - No Zombie Shield (isNull deletedAt) needed: dispatch_messages has no
//     deletedAt column — messages use a terminal status model instead.
//   - deleteOlderThan performs a physical hard-delete: messages are log-style
//     records cleaned by age-based retention policy (Sweeper).
//   - findFailedForRetry compares two columns (retryCount < maxRetries) using
//     Drizzle's lt() operator.
//   - findByThread uses cursor-based pagination on createdAt to avoid N-row
//     scans on large threads.
//   - updateStatusBulk executes individual updates in sequence — Drizzle does
//     not support a single batch UPDATE with different values per row.
//   - Mapper functions handle undefined ↔ null conversion at the DB boundary.
//
// Factory pattern for dependency injection:
//   const repository = makeMessageRepository(db);
//   await repository.findPendingOutbound('email', 50);
// =============================================================================

import { eq, and, lt, gt, asc, desc, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as dispatchSchema from '../../schema';
import { dispatchMessages } from '../../schema/messages';
import {
  Message,
  MessageDirection,
  MessagePayload,
  MessageStatus,
} from '../../domain/message';
import { IMessageRepository } from '../../domain/messageRepository';

// =============================================================================
// Database Type
// =============================================================================

/**
 * The type of the Drizzle database instance this module requires.
 * Consuming applications create a drizzle() instance with the Dispatch schema
 * and pass it to repository factories.
 */
export type DispatchDatabase = ReturnType<typeof drizzle<typeof dispatchSchema>>;

// =============================================================================
// Repository Factory
// =============================================================================

/**
 * Factory function that creates a Message repository instance.
 *
 * @param db - Drizzle database instance with Dispatch schema
 * @returns IMessageRepository implementation
 */
export const makeMessageRepository = (db: DispatchDatabase): IMessageRepository => ({
  /**
   * Persist a new Message to storage.
   * Converts undefined domain values to null for database compatibility.
   */
  async save(message: Message): Promise<void> {
    await db.insert(dispatchMessages).values(mapToRow(message));
  },

  /**
   * Persist multiple Messages in a single batch operation.
   * Uses a single INSERT with multiple value rows for one round-trip.
   */
  async saveBulk(messages: Message[]): Promise<void> {
    if (messages.length === 0) return;
    await db.insert(dispatchMessages).values(messages.map(mapToRow));
  },

  /**
   * Find a Message by its unique ID.
   * No Zombie Shield needed — dispatch_messages has no deletedAt column.
   */
  async findById(id: string): Promise<Message | null> {
    const result = await db
      .select()
      .from(dispatchMessages)
      .where(eq(dispatchMessages.id, id))
      .limit(1);

    if (result.length === 0) return null;
    return mapToMessage(result[0]);
  },

  /**
   * Find outbound messages in 'pending' status for a given channel.
   * Ordered by createdAt ascending so oldest messages are dispatched first.
   */
  async findPendingOutbound(channel: string, limit: number): Promise<Message[]> {
    const result = await db
      .select()
      .from(dispatchMessages)
      .where(
        and(
          eq(dispatchMessages.status, 'pending'),
          eq(dispatchMessages.direction, 'outbound'),
          eq(dispatchMessages.channel, channel),
        ),
      )
      .orderBy(asc(dispatchMessages.createdAt))
      .limit(limit);

    return result.map(mapToMessage);
  },

  /**
   * Find inbound messages in 'received' status, ready for handler routing.
   * Ordered by createdAt ascending so oldest messages are processed first.
   */
  async findUnprocessedInbound(limit: number): Promise<Message[]> {
    const result = await db
      .select()
      .from(dispatchMessages)
      .where(
        and(
          eq(dispatchMessages.status, 'received'),
          eq(dispatchMessages.direction, 'inbound'),
        ),
      )
      .orderBy(asc(dispatchMessages.createdAt))
      .limit(limit);

    return result.map(mapToMessage);
  },

  /**
   * Find failed messages eligible for retry (retryCount < maxRetries) filtered by direction.
   * Uses column-to-column comparison via lt() to keep the retry eligibility check in SQL.
   * Ordered by lastAttemptAt ascending (nulls sort first via createdAt fallback in SQL).
   */
  async findFailedForRetry(direction: MessageDirection, limit: number): Promise<Message[]> {
    const result = await db
      .select()
      .from(dispatchMessages)
      .where(
        and(
          eq(dispatchMessages.status, 'failed'),
          eq(dispatchMessages.direction, direction),
          lt(dispatchMessages.retryCount, dispatchMessages.maxRetries),
        ),
      )
      .orderBy(
        asc(sql`COALESCE(${dispatchMessages.lastAttemptAt}, ${dispatchMessages.createdAt})`),
      )
      .limit(limit);

    return result.map(mapToMessage);
  },

  /**
   * Find all messages belonging to a thread, ordered by createdAt ascending.
   * Supports cursor-based pagination: if a cursor (message ID) is provided,
   * fetch that message's createdAt then return only messages after that point.
   *
   * Default limit: 50.
   */
  async findByThread(threadId: string, cursor?: string, limit = 50): Promise<Message[]> {
    if (cursor) {
      // Resolve cursor message's createdAt for keyset pagination
      const cursorResult = await db
        .select({ createdAt: dispatchMessages.createdAt })
        .from(dispatchMessages)
        .where(eq(dispatchMessages.id, cursor))
        .limit(1);

      if (cursorResult.length === 0) {
        // Cursor not found — return empty to avoid returning incorrect page
        return [];
      }

      const cursorCreatedAt = cursorResult[0].createdAt;

      const result = await db
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

      return result.map(mapToMessage);
    }

    const result = await db
      .select()
      .from(dispatchMessages)
      .where(eq(dispatchMessages.threadId, threadId))
      .orderBy(asc(dispatchMessages.createdAt))
      .limit(limit);

    return result.map(mapToMessage);
  },

  /**
   * Apply a partial status-related update to a Message by ID.
   * Always bumps updatedAt to the current timestamp.
   * Converts undefined values to null for nullable DB columns.
   */
  async updateStatus(
    id: string,
    updates: Partial<
      Pick<
        Message,
        | 'status'
        | 'retryCount'
        | 'lastAttemptAt'
        | 'deliveredAt'
        | 'processedAt'
        | 'providerResponse'
      >
    >,
  ): Promise<void> {
    const setValues: Record<string, unknown> = { updatedAt: new Date() };

    if (updates.status !== undefined) setValues.status = updates.status;
    if (updates.retryCount !== undefined) setValues.retryCount = updates.retryCount;
    if ('lastAttemptAt' in updates) setValues.lastAttemptAt = updates.lastAttemptAt ?? null;
    if ('deliveredAt' in updates) setValues.deliveredAt = updates.deliveredAt ?? null;
    if ('processedAt' in updates) setValues.processedAt = updates.processedAt ?? null;
    if ('providerResponse' in updates)
      setValues.providerResponse = updates.providerResponse ?? null;

    await db
      .update(dispatchMessages)
      .set(setValues)
      .where(eq(dispatchMessages.id, id));
  },

  /**
   * Apply partial status-related updates to multiple Messages in sequence.
   * Drizzle does not support a single batch UPDATE with different values per row,
   * so updates are executed individually. Each update bumps updatedAt.
   */
  async updateStatusBulk(
    updates: Array<{
      id: string;
      changes: Partial<
        Pick<
          Message,
          | 'status'
          | 'retryCount'
          | 'lastAttemptAt'
          | 'deliveredAt'
          | 'processedAt'
          | 'providerResponse'
        >
      >;
    }>,
  ): Promise<void> {
    for (const { id, changes } of updates) {
      const setValues: Record<string, unknown> = { updatedAt: new Date() };

      if (changes.status !== undefined) setValues.status = changes.status;
      if (changes.retryCount !== undefined) setValues.retryCount = changes.retryCount;
      if ('lastAttemptAt' in changes) setValues.lastAttemptAt = changes.lastAttemptAt ?? null;
      if ('deliveredAt' in changes) setValues.deliveredAt = changes.deliveredAt ?? null;
      if ('processedAt' in changes) setValues.processedAt = changes.processedAt ?? null;
      if ('providerResponse' in changes)
        setValues.providerResponse = changes.providerResponse ?? null;

      await db
        .update(dispatchMessages)
        .set(setValues)
        .where(eq(dispatchMessages.id, id));
    }
  },

  /**
   * Hard-delete all Messages with createdAt older than the given date.
   * Returns the number of records deleted.
   * Physical deletion is acceptable for log-style records past their retention window.
   */
  async deleteOlderThan(date: Date): Promise<number> {
    const deleted = await db
      .delete(dispatchMessages)
      .where(lt(dispatchMessages.createdAt, date))
      .returning({ id: dispatchMessages.id });

    return deleted.length;
  },

  /**
   * Find the most recent Message where providerResponse JSONB contains a field
   * matching the given value. Optional filters scope by channel, direction, status.
   * Returns null if not found.
   */
  async findByProviderRef(
    field: string,
    value: string,
    filters?: { channel?: string; direction?: MessageDirection; status?: MessageStatus },
  ): Promise<Message | null> {
    const conditions = [
      sql`${dispatchMessages.providerResponse}->>'${sql.raw(field)}' = ${value}`,
    ];

    if (filters?.channel !== undefined) {
      conditions.push(eq(dispatchMessages.channel, filters.channel));
    }
    if (filters?.direction !== undefined) {
      conditions.push(eq(dispatchMessages.direction, filters.direction));
    }
    if (filters?.status !== undefined) {
      conditions.push(eq(dispatchMessages.status, filters.status));
    }

    const result = await db
      .select()
      .from(dispatchMessages)
      .where(and(...conditions))
      .orderBy(desc(dispatchMessages.createdAt))
      .limit(1);

    if (result.length === 0) return null;
    return mapToMessage(result[0]);
  },

  /**
   * Find the earliest sent outbound Message for a given source entity.
   * Used to locate the original sent message so callers can retrieve its
   * providerResponse for thread correlation (e.g. Slack thread_ts).
   * Returns null if not found.
   */
  async findSentBySource(sourceType: string, sourceId: string): Promise<Message | null> {
    const result = await db
      .select()
      .from(dispatchMessages)
      .where(
        and(
          eq(dispatchMessages.sourceType, sourceType),
          eq(dispatchMessages.sourceId, sourceId),
          eq(dispatchMessages.direction, 'outbound'),
          eq(dispatchMessages.status, 'sent'),
        ),
      )
      .orderBy(asc(dispatchMessages.createdAt))
      .limit(1);

    if (result.length === 0) return null;
    return mapToMessage(result[0]);
  },
});

// =============================================================================
// Internal Mapping Functions
// =============================================================================

/**
 * Maps a domain Message to a DB row shape for INSERT operations.
 * Converts undefined domain values to null for nullable DB columns.
 */
function mapToRow(message: Message): typeof dispatchMessages.$inferInsert {
  return {
    id: message.id,
    direction: message.direction,
    channel: message.channel,
    principalId: message.principalId ?? null,
    externalAddress: message.externalAddress,
    threadId: message.threadId ?? null,
    replyToMessageId: message.replyToMessageId ?? null,
    sourceType: message.sourceType ?? null,
    sourceId: message.sourceId ?? null,
    payload: message.payload as Record<string, unknown>,
    status: message.status,
    retryCount: message.retryCount,
    maxRetries: message.maxRetries,
    lastAttemptAt: message.lastAttemptAt ?? null,
    deliveredAt: message.deliveredAt ?? null,
    providerResponse: (message.providerResponse as Record<string, unknown> | undefined) ?? null,
    receivedAt: message.receivedAt ?? null,
    processedAt: message.processedAt ?? null,
    metadata: (message.metadata as Record<string, unknown> | undefined) ?? null,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  };
}

/**
 * Maps a Drizzle query result row to the domain Message type.
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
