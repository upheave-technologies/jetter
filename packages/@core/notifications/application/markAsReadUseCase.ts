// =============================================================================
// Application — Mark As Read Use Case
// =============================================================================
// Marks a single Notification as read for the owning Principal.
//
// Flow:
//   1. Fetch notification via repo.findById() — null → NOTIFICATION_NOT_FOUND
//   2. Verify ownership: notification.principalId !== principalId → UNAUTHORIZED
//   3. Apply domain transformation: markAsRead(notification, now)
//   4. Persist updated notification via repo.markAsRead()
//   5. Return the updated Notification
// =============================================================================

import { Result } from '../../../shared/lib/result';
import { Notification, markAsRead } from '../domain/notification';
import { INotificationRepository } from '../domain/notificationRepository';
import { NotificationError } from './notificationError';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type MarkAsReadInput = {
  principalId: string;
  notificationId: string;
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the markAsRead use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeMarkAsReadUseCase = (repo: INotificationRepository) => {
  return async (
    data: MarkAsReadInput
  ): Promise<Result<Notification, NotificationError>> => {
    try {
      // Step 1: Fetch the notification (Zombie Shield active — soft-deleted invisible)
      const notification = await repo.findById(data.notificationId);

      if (notification === null) {
        return {
          success: false,
          error: new NotificationError(
            `Notification with id "${data.notificationId}" was not found`,
            'NOTIFICATION_NOT_FOUND'
          ),
        };
      }

      // Step 2: Verify the requesting principal owns this notification
      if (notification.principalId !== data.principalId) {
        return {
          success: false,
          error: new NotificationError(
            'Principal does not own this notification',
            'UNAUTHORIZED'
          ),
        };
      }

      // Step 3: Apply domain transformation (pure — no mutation)
      const updated = markAsRead(notification, new Date());

      // Step 4: Persist updated read state
      await repo.markAsRead(updated);

      // Step 5: Return updated Notification
      return { success: true, value: updated };
    } catch {
      return {
        success: false,
        error: new NotificationError(
          'Failed to mark notification as read',
          'SERVICE_ERROR'
        ),
      };
    }
  };
};
