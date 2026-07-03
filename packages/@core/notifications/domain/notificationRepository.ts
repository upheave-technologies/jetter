// =============================================================================
// Domain — Notification Repository Interface
// =============================================================================
// This is the CONTRACT for Notification and NotificationPreference persistence
// operations. The domain layer defines WHAT is needed; the infrastructure layer
// provides the concrete Drizzle implementation.
//
// Notifications and preferences share one repository because they are always
// co-accessed during notification creation: the use case must check preferences
// before deciding which channels to dispatch on. Keeping them in one interface
// avoids an unnecessary second dependency injection point for a tightly coupled
// pair of reads.
//
// Zombie Shield
// -------------
// All read methods filter soft-deleted notifications (deletedAt IS NULL)
// automatically. This prevents "zombie" notifications — records that appear
// deleted to the system but can still be accidentally returned — from surfacing
// in normal application flows.
//
// Preference records are never soft-deleted; they are upserted in place.
// =============================================================================

import { Notification } from './notification';
import { NotificationPreference } from './notificationPreference';

// =============================================================================
// PAGINATION AND FILTER TYPES
// =============================================================================

/**
 * Opaque cursor used for stable keyset pagination.
 * Encodes the position of the last item seen in the sorted result set.
 * Sorted by createdAt DESC, then id DESC to break ties deterministically.
 */
export type NotificationCursor = {
  createdAt: Date;
  id: string;
};

/**
 * Paginated result returned by findByPrincipal.
 */
export type PaginatedNotifications = {
  notifications: Notification[];
  nextCursor: NotificationCursor | null;
  hasMore: boolean;
};

/**
 * Filter options for listing notifications.
 * All fields are optional — omitting a field applies no constraint for that dimension.
 */
export type NotificationFilter = {
  /** Filter by read status. */
  read?: boolean;
  /** Filter by notification type (exact match). */
  type?: string;
  /** Filter by urgency level (exact match). */
  urgency?: string;
  /** Inclusive lower bound on createdAt. */
  from?: Date;
  /** Inclusive upper bound on createdAt. */
  to?: Date;
};

/**
 * Aggregated counts returned by countByPrincipal.
 */
export type NotificationCounts = {
  total: number;
  unread: number;
  read: number;
};

// =============================================================================
// REPOSITORY INTERFACE
// =============================================================================

export type INotificationRepository = {
  // ===========================================================================
  // NOTIFICATION METHODS
  // Zombie Shield: all read methods filter deletedAt IS NULL automatically.
  // ===========================================================================

  /**
   * Persist a new notification.
   */
  save: (notification: Notification) => Promise<void>;

  /**
   * Persist multiple notifications in a single operation.
   * Used by bulk notification creation to avoid N round-trips.
   */
  saveBulk: (notifications: Notification[]) => Promise<void>;

  /**
   * Find an active notification by its unique ID.
   * Returns null if not found or soft-deleted (Zombie Shield active).
   */
  findById: (id: string) => Promise<Notification | null>;

  /**
   * Paginated list of active notifications for a Principal.
   * Zombie Shield: excludes soft-deleted records.
   * Ordered by createdAt DESC, then id DESC for stable cursor-based pagination.
   *
   * @param principalId - The Principal whose notifications to fetch.
   * @param options.cursor - Start after this cursor position (exclusive).
   * @param options.limit  - Maximum number of notifications to return.
   * @param options.filter - Optional dimension filters (read, type, urgency, date range).
   */
  findByPrincipal: (
    principalId: string,
    options?: {
      cursor?: NotificationCursor;
      limit?: number;
      filter?: NotificationFilter;
    }
  ) => Promise<PaginatedNotifications>;

  /**
   * Return total, unread, and read counts for a Principal's notifications.
   * Zombie Shield: excludes soft-deleted records.
   */
  countByPrincipal: (principalId: string) => Promise<NotificationCounts>;

  /**
   * Return the number of unread notifications for a Principal.
   * Optionally scoped to a specific urgency level (e.g. badge for "urgent" only).
   * Zombie Shield: excludes soft-deleted records.
   */
  getUnreadCount: (principalId: string, urgency?: string) => Promise<number>;

  /**
   * Persist the updated read state of a single notification.
   * The caller is responsible for applying markAsRead() before calling this.
   */
  markAsRead: (notification: Notification) => Promise<void>;

  /**
   * Bulk-mark all unread notifications as read for a Principal.
   * Returns the count of notifications updated.
   *
   * @param principalId - The Principal whose notifications to mark.
   * @param at          - The timestamp to set as readAt for all updated records.
   */
  markAllAsRead: (principalId: string, at: Date) => Promise<number>;

  /**
   * Soft-delete all notifications whose createdAt is before the given date.
   * Used by the async TTL sweeper for time-based cleanup.
   * Returns the count of notifications soft-deleted.
   *
   * @param date - Notifications created strictly before this date are soft-deleted.
   */
  deleteOlderThan: (date: Date) => Promise<number>;

  // ===========================================================================
  // PREFERENCE METHODS
  // Preference records are never soft-deleted — upsert semantics apply.
  // ===========================================================================

  /**
   * Get the NotificationPreference record for a Principal.
   * Returns null if no preference record exists yet.
   * The use case is responsible for auto-creating defaults in that case.
   */
  getPreferences: (principalId: string) => Promise<NotificationPreference | null>;

  /**
   * Bulk-fetch preference records for multiple Principals in a single query.
   * Returns a Map keyed by principalId. Principals with no preference record
   * are absent from the map (use case applies defaults for missing entries).
   * Used by createBulkNotifications to avoid N+1 preference lookups.
   */
  getPreferencesBulk: (principalIds: string[]) => Promise<Map<string, NotificationPreference>>;

  /**
   * Persist a NotificationPreference record (upsert semantics).
   * Creates a new record if none exists, updates the existing record otherwise.
   */
  savePreferences: (preference: NotificationPreference) => Promise<void>;
};
