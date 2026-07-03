// =============================================================================
// Application — Get Notifications Use Case
// =============================================================================
// Returns a paginated list of active notifications for a Principal.
//
// Flow:
//   1. Call repo.findByPrincipal() with cursor, limit, and filter options
//   2. Return the paginated result
// =============================================================================

import { Result } from '../../../shared/lib/result';
import {
  INotificationRepository,
  NotificationCursor,
  NotificationFilter,
  PaginatedNotifications,
} from '../domain/notificationRepository';
import { NotificationError } from './notificationError';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type GetNotificationsInput = {
  principalId: string;
  cursor?: NotificationCursor;
  limit?: number;
  filter?: NotificationFilter;
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the getNotifications use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeGetNotificationsUseCase = (repo: INotificationRepository) => {
  return async (
    data: GetNotificationsInput
  ): Promise<Result<PaginatedNotifications, NotificationError>> => {
    try {
      // Step 1: Fetch paginated notifications (Zombie Shield active in repo)
      const result = await repo.findByPrincipal(data.principalId, {
        cursor: data.cursor,
        limit: data.limit,
        filter: data.filter,
      });

      // Step 2: Return paginated result
      return { success: true, value: result };
    } catch {
      return {
        success: false,
        error: new NotificationError(
          'Failed to retrieve notifications',
          'SERVICE_ERROR'
        ),
      };
    }
  };
};
