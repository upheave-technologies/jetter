// =============================================================================
// Application — Get Unread Count Use Case
// =============================================================================
// Returns the number of unread notifications for a Principal, optionally
// scoped to a specific urgency level.
//
// Flow:
//   1. Call repo.getUnreadCount() with optional urgency filter
//   2. Return the count
// =============================================================================

import { Result } from '../../../shared/lib/result';
import { INotificationRepository } from '../domain/notificationRepository';
import { NotificationError } from './notificationError';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type GetUnreadCountInput = {
  principalId: string;
  urgency?: string;
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the getUnreadCount use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeGetUnreadCountUseCase = (repo: INotificationRepository) => {
  return async (
    data: GetUnreadCountInput
  ): Promise<Result<number, NotificationError>> => {
    try {
      // Step 1: Fetch unread count, optionally scoped by urgency
      const count = await repo.getUnreadCount(data.principalId, data.urgency);

      // Step 2: Return count
      return { success: true, value: count };
    } catch {
      return {
        success: false,
        error: new NotificationError(
          'Failed to retrieve unread count',
          'SERVICE_ERROR'
        ),
      };
    }
  };
};
