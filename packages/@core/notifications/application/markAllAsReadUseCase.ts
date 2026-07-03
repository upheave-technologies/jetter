// =============================================================================
// Application — Mark All As Read Use Case
// =============================================================================
// Bulk-marks all unread notifications as read for a Principal.
//
// Flow:
//   1. Call repo.markAllAsRead() with the principal's id and current timestamp
//   2. Return the count of notifications updated
// =============================================================================

import { Result } from '../../../shared/lib/result';
import { INotificationRepository } from '../domain/notificationRepository';
import { NotificationError } from './notificationError';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type MarkAllAsReadInput = {
  principalId: string;
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the markAllAsRead use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeMarkAllAsReadUseCase = (repo: INotificationRepository) => {
  return async (
    data: MarkAllAsReadInput
  ): Promise<Result<number, NotificationError>> => {
    try {
      // Step 1: Bulk-mark all unread notifications with current timestamp
      const count = await repo.markAllAsRead(data.principalId, new Date());

      // Step 2: Return updated count
      return { success: true, value: count };
    } catch {
      return {
        success: false,
        error: new NotificationError(
          'Failed to mark all notifications as read',
          'SERVICE_ERROR'
        ),
      };
    }
  };
};
