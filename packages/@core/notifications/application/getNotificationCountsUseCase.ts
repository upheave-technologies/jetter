// =============================================================================
// Application — Get Notification Counts Use Case
// =============================================================================
// Returns aggregated total, unread, and read counts for a Principal's
// active notifications.
//
// Flow:
//   1. Call repo.countByPrincipal()
//   2. Return the counts
// =============================================================================

import { Result } from '../../../shared/lib/result';
import {
  INotificationRepository,
  NotificationCounts,
} from '../domain/notificationRepository';
import { NotificationError } from './notificationError';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type GetNotificationCountsInput = {
  principalId: string;
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the getNotificationCounts use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeGetNotificationCountsUseCase = (
  repo: INotificationRepository
) => {
  return async (
    data: GetNotificationCountsInput
  ): Promise<Result<NotificationCounts, NotificationError>> => {
    try {
      // Step 1: Fetch aggregated counts (Zombie Shield active in repo)
      const counts = await repo.countByPrincipal(data.principalId);

      // Step 2: Return counts
      return { success: true, value: counts };
    } catch {
      return {
        success: false,
        error: new NotificationError(
          'Failed to retrieve notification counts',
          'SERVICE_ERROR'
        ),
      };
    }
  };
};
