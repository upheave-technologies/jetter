// =============================================================================
// Infrastructure — Drizzle Notification Repository
// =============================================================================
// Concrete implementation of INotificationRepository using Drizzle ORM.
//
// Covers persistence for both Notification and NotificationPreference entities.
// These two entities share one repository because they are always co-accessed
// during notification creation: the use case must check preferences before
// deciding which channels to dispatch on.
//
// Zombie Shield
// -------------
// ALL notification read queries include `isNull(table.deletedAt)`.
// This is non-negotiable: a single query that omits this filter can surface
// soft-deleted records and corrupt application state.
//
// Preference records have NO deletedAt column — do NOT filter by it.
//
// Patterns:
//   - Factory function (makeNotificationRepository) — no class, no singleton
//   - undefined ↔ null: domain uses undefined, DB uses null
//   - Cursor-based pagination — NOT offset — for stable feed ordering
//   - saveBulk and getPreferencesBulk short-circuit on empty input
//
// Factory usage:
//   const repo = makeNotificationRepository(db);
//   await repo.findById('notif-id');
// =============================================================================

import {
  eq,
  and,
  isNull,
  or,
  lt,
  lte,
  gte,
  count,
  inArray,
  desc,
} from 'drizzle-orm';
import { notificationsNotifications } from '../../schema/notifications';
import { notificationsPreferences } from '../../schema/preferences';
import {
  Notification,
  NotificationContent,
  Urgency,
} from '../../domain/notification';
import {
  NotificationPreference,
  NotificationPreferences,
} from '../../domain/notificationPreference';
import {
  INotificationRepository,
  NotificationCounts,
  NotificationCursor,
  NotificationFilter,
  PaginatedNotifications,
} from '../../domain/notificationRepository';
import { NotificationsDatabase } from '../database';

// =============================================================================
// Type aliases for brevity
// =============================================================================

type NotifRow = typeof notificationsNotifications.$inferSelect;
type PrefRow = typeof notificationsPreferences.$inferSelect;

// =============================================================================
// Factory
// =============================================================================

/**
 * Factory function that creates a Notification repository instance.
 *
 * @param db - Drizzle database instance with Notifications schema
 * @returns INotificationRepository implementation
 */
export const makeNotificationRepository = (
  db: NotificationsDatabase
): INotificationRepository => {
  return {
    // =========================================================================
    // NOTIFICATION METHODS
    // =========================================================================

    /**
     * Persist a new notification.
     * Converts domain undefined fields to null for database compatibility.
     */
    async save(notification: Notification): Promise<void> {
      await db.insert(notificationsNotifications).values({
        id: notification.id,
        principalId: notification.principalId,
        type: notification.type,
        urgency: notification.urgency,
        content: notification.content,
        channels: notification.channels,
        read: notification.read,
        readAt: notification.readAt ?? null,
        metadata: notification.metadata ?? null,
        deletedAt: notification.deletedAt ?? null,
        createdAt: notification.createdAt,
        updatedAt: notification.updatedAt,
      });
    },

    /**
     * Persist multiple notifications in a single batch insert.
     * Short-circuits immediately if the array is empty to avoid an invalid
     * empty-values insert.
     */
    async saveBulk(notifications: Notification[]): Promise<void> {
      if (notifications.length === 0) return;

      await db.insert(notificationsNotifications).values(
        notifications.map((n) => ({
          id: n.id,
          principalId: n.principalId,
          type: n.type,
          urgency: n.urgency,
          content: n.content,
          channels: n.channels,
          read: n.read,
          readAt: n.readAt ?? null,
          metadata: n.metadata ?? null,
          deletedAt: n.deletedAt ?? null,
          createdAt: n.createdAt,
          updatedAt: n.updatedAt,
        }))
      );
    },

    /**
     * Find an active notification by its unique ID.
     * ZOMBIE SHIELD: filters out soft-deleted records.
     */
    async findById(id: string): Promise<Notification | null> {
      const result = await db
        .select()
        .from(notificationsNotifications)
        .where(
          and(
            eq(notificationsNotifications.id, id),
            isNull(notificationsNotifications.deletedAt)
          )
        )
        .limit(1);

      if (result.length === 0) return null;
      return mapToNotification(result[0] as NotifRow);
    },

    /**
     * Paginated list of active notifications for a Principal.
     * ZOMBIE SHIELD: always excludes soft-deleted records.
     * Ordered by createdAt DESC then id DESC for stable cursor pagination.
     *
     * Fetches limit + 1 rows: if the extra row exists, hasMore = true.
     */
    async findByPrincipal(
      principalId: string,
      options?: {
        cursor?: NotificationCursor;
        limit?: number;
        filter?: NotificationFilter;
      }
    ): Promise<PaginatedNotifications> {
      const limit = options?.limit ?? 20;
      const cursor = options?.cursor;
      const filter = options?.filter;

      // Build WHERE conditions
      const conditions = [
        eq(notificationsNotifications.principalId, principalId),
        isNull(notificationsNotifications.deletedAt),
      ];

      // Cursor: (createdAt < cursor.createdAt) OR
      //         (createdAt = cursor.createdAt AND id < cursor.id)
      if (cursor) {
        conditions.push(
          or(
            lt(notificationsNotifications.createdAt, cursor.createdAt),
            and(
              lte(notificationsNotifications.createdAt, cursor.createdAt),
              lt(notificationsNotifications.id, cursor.id)
            )
          )!
        );
      }

      // Optional dimension filters
      if (filter?.read !== undefined) {
        conditions.push(eq(notificationsNotifications.read, filter.read));
      }
      if (filter?.type !== undefined) {
        conditions.push(eq(notificationsNotifications.type, filter.type));
      }
      if (filter?.urgency !== undefined) {
        conditions.push(
          eq(notificationsNotifications.urgency, filter.urgency as Urgency)
        );
      }
      if (filter?.from !== undefined) {
        conditions.push(gte(notificationsNotifications.createdAt, filter.from));
      }
      if (filter?.to !== undefined) {
        conditions.push(lte(notificationsNotifications.createdAt, filter.to));
      }

      const rows = await db
        .select()
        .from(notificationsNotifications)
        .where(and(...conditions))
        .orderBy(
          desc(notificationsNotifications.createdAt),
          desc(notificationsNotifications.id)
        )
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const pageRows = hasMore ? (rows as NotifRow[]).slice(0, limit) : (rows as NotifRow[]);
      const notifications = pageRows.map(mapToNotification);

      const nextCursor: NotificationCursor | null = hasMore
        ? {
            createdAt: pageRows[pageRows.length - 1].createdAt,
            id: pageRows[pageRows.length - 1].id,
          }
        : null;

      return { notifications, nextCursor, hasMore };
    },

    /**
     * Return total, unread, and read counts for a Principal's active notifications.
     * ZOMBIE SHIELD: excludes soft-deleted records.
     */
    async countByPrincipal(principalId: string): Promise<NotificationCounts> {
      const baseCondition = and(
        eq(notificationsNotifications.principalId, principalId),
        isNull(notificationsNotifications.deletedAt)
      );

      const totalResult = await db
        .select({ value: count() })
        .from(notificationsNotifications)
        .where(baseCondition);

      const unreadResult = await db
        .select({ value: count() })
        .from(notificationsNotifications)
        .where(and(baseCondition, eq(notificationsNotifications.read, false)));

      const readResult = await db
        .select({ value: count() })
        .from(notificationsNotifications)
        .where(and(baseCondition, eq(notificationsNotifications.read, true)));

      const total = Number(totalResult[0]?.value ?? 0);
      const unread = Number(unreadResult[0]?.value ?? 0);
      const read = Number(readResult[0]?.value ?? 0);

      return { total, unread, read };
    },

    /**
     * Return the count of unread active notifications for a Principal.
     * Optionally scoped to a specific urgency level.
     * ZOMBIE SHIELD: excludes soft-deleted records.
     */
    async getUnreadCount(principalId: string, urgency?: string): Promise<number> {
      const conditions = [
        eq(notificationsNotifications.principalId, principalId),
        isNull(notificationsNotifications.deletedAt),
        eq(notificationsNotifications.read, false),
      ];

      if (urgency !== undefined) {
        conditions.push(
          eq(notificationsNotifications.urgency, urgency as Urgency)
        );
      }

      const result = await db
        .select({ value: count() })
        .from(notificationsNotifications)
        .where(and(...conditions));

      return Number(result[0]?.value ?? 0);
    },

    /**
     * Persist the updated read state of a single notification.
     * Caller must have already applied markAsRead() to the domain entity.
     */
    async markAsRead(notification: Notification): Promise<void> {
      await db
        .update(notificationsNotifications)
        .set({
          read: true,
          readAt: notification.readAt ?? null,
          updatedAt: new Date(),
        })
        .where(eq(notificationsNotifications.id, notification.id));
    },

    /**
     * Bulk-mark all unread active notifications as read for a Principal.
     * Returns the count of notifications updated.
     * ZOMBIE SHIELD: only updates non-deleted records.
     */
    async markAllAsRead(principalId: string, at: Date): Promise<number> {
      const result = await db
        .update(notificationsNotifications)
        .set({
          read: true,
          readAt: at,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(notificationsNotifications.principalId, principalId),
            eq(notificationsNotifications.read, false),
            isNull(notificationsNotifications.deletedAt)
          )
        )
        .returning({ id: notificationsNotifications.id });

      return result.length;
    },

    /**
     * Soft-delete all notifications created before the given date.
     * Used by the TTL sweeper for time-based cleanup.
     * Returns the count of notifications soft-deleted.
     * NEVER hard-deletes — preserves audit trail.
     */
    async deleteOlderThan(date: Date): Promise<number> {
      const result = await db
        .update(notificationsNotifications)
        .set({
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            lt(notificationsNotifications.createdAt, date),
            isNull(notificationsNotifications.deletedAt)
          )
        )
        .returning({ id: notificationsNotifications.id });

      return result.length;
    },

    // =========================================================================
    // PREFERENCE METHODS
    // Preferences have NO deletedAt — never filter by it.
    // =========================================================================

    /**
     * Get the NotificationPreference record for a Principal.
     * Returns null if no record exists (use case applies defaults in that case).
     */
    async getPreferences(principalId: string): Promise<NotificationPreference | null> {
      const result = await db
        .select()
        .from(notificationsPreferences)
        .where(eq(notificationsPreferences.principalId, principalId))
        .limit(1);

      if (result.length === 0) return null;
      return mapToPreference(result[0] as PrefRow);
    },

    /**
     * Bulk-fetch preference records for multiple Principals in a single query.
     * Returns a Map keyed by principalId.
     * Principals with no preference record are absent from the map.
     * Short-circuits on empty input — returns an empty Map without a DB call.
     */
    async getPreferencesBulk(
      principalIds: string[]
    ): Promise<Map<string, NotificationPreference>> {
      if (principalIds.length === 0) return new Map();

      const rows = await db
        .select()
        .from(notificationsPreferences)
        .where(inArray(notificationsPreferences.principalId, principalIds));

      const map = new Map<string, NotificationPreference>();
      for (const row of rows as PrefRow[]) {
        const pref = mapToPreference(row);
        map.set(pref.principalId, pref);
      }
      return map;
    },

    /**
     * Persist a NotificationPreference record (upsert semantics).
     * Creates a new record if none exists; updates the existing record otherwise.
     * Conflict target: principalId unique constraint.
     */
    async savePreferences(preference: NotificationPreference): Promise<void> {
      await db
        .insert(notificationsPreferences)
        .values({
          id: preference.id,
          principalId: preference.principalId,
          preferences: preference.preferences,
          metadata: preference.metadata ?? null,
          createdAt: preference.createdAt,
          updatedAt: preference.updatedAt,
        })
        .onConflictDoUpdate({
          target: notificationsPreferences.principalId,
          set: {
            preferences: preference.preferences,
            metadata: preference.metadata ?? null,
            updatedAt: new Date(),
          },
        });
    },
  };
};

// =============================================================================
// Internal Mapping Functions
// =============================================================================

/**
 * Maps a Drizzle query result row to the domain Notification type.
 *
 * Handles type conversions:
 *   - urgency (enum string)           → cast to domain Urgency type
 *   - content (jsonb)                 → cast to NotificationContent
 *   - channels (text[])               → cast to string[]
 *   - readAt (timestamp | null)       → convert null to undefined
 *   - metadata (jsonb | null)         → cast and convert null to undefined
 *   - deletedAt (timestamp | null)    → convert null to undefined
 */
function mapToNotification(row: NotifRow): Notification {
  return {
    id: row.id,
    principalId: row.principalId,
    type: row.type,
    urgency: row.urgency as Urgency,
    content: row.content as NotificationContent,
    channels: row.channels as string[],
    read: row.read,
    readAt: row.readAt ?? undefined,
    metadata: (row.metadata as Record<string, unknown> | null) ?? undefined,
    deletedAt: row.deletedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Maps a Drizzle query result row to the domain NotificationPreference type.
 *
 * Handles type conversions:
 *   - preferences (jsonb)             → cast to NotificationPreferences
 *   - metadata (jsonb | null)         → cast and convert null to undefined
 */
function mapToPreference(row: PrefRow): NotificationPreference {
  return {
    id: row.id,
    principalId: row.principalId,
    preferences: row.preferences as NotificationPreferences,
    metadata: (row.metadata as Record<string, unknown> | null) ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
