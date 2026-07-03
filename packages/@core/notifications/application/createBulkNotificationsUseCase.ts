// =============================================================================
// Application — Create Bulk Notifications Use Case
// =============================================================================
// Orchestrates the creation of multiple Notifications in a single operation.
//
// Flow:
//   1. Extract unique principalIds from the input array
//   2. Bulk-fetch preferences for all principals via repo.getPreferencesBulk()
//      (single query — avoids N+1 preference lookups)
//   3. For each notification input, resolve effective channels using the
//      preference map (or system defaults if the principal has no record)
//   4. Validate each input via createNotification() — collect all errors
//   5. If ANY input fails validation → return VALIDATION_ERROR with first error
//   6. Assemble full Notification entities with cuid2 ids and timestamps
//   7. Persist all via repo.saveBulk()
//   8. Return the array of created Notifications
// =============================================================================

import { createId } from '@paralleldrive/cuid2';
import { Result } from '../../../shared/lib/result';
import {
  Notification,
  NotificationContent,
  createNotification,
} from '../domain/notification';
import {
  getDefaultPreferences,
  shouldSendNotification,
} from '../domain/notificationPreference';
import { INotificationRepository } from '../domain/notificationRepository';
import { NotificationError } from './notificationError';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type BulkNotificationItem = {
  principalId: string;
  type: string;
  urgency: string;
  content: NotificationContent;
  channels: string[];
  metadata?: Record<string, unknown>;
};

export type CreateBulkNotificationsInput = {
  notifications: BulkNotificationItem[];
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the createBulkNotifications use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeCreateBulkNotificationsUseCase = (
  repo: INotificationRepository
) => {
  return async (
    data: CreateBulkNotificationsInput
  ): Promise<Result<Notification[], NotificationError>> => {
    try {
      // Step 1: Extract unique principalIds
      const uniquePrincipalIds = [
        ...new Set(data.notifications.map((n) => n.principalId)),
      ];

      // Step 2: Bulk-fetch preferences in a single query
      const preferencesMap = await repo.getPreferencesBulk(uniquePrincipalIds);

      // Steps 3–4: Resolve channels and validate each notification
      const now = new Date();
      const assembled: Notification[] = [];

      for (const item of data.notifications) {
        // Resolve preferences for this principal
        const prefRecord = preferencesMap.get(item.principalId);
        const preferences = prefRecord?.preferences ?? getDefaultPreferences();

        // Resolve effective channels
        const resolvedChannels = item.channels.filter((channel) =>
          shouldSendNotification(preferences, channel, item.type)
        );
        const channelsForRecord =
          resolvedChannels.length > 0 ? resolvedChannels : item.channels;

        // Validate via domain factory
        const notificationResult = createNotification({
          principalId: item.principalId,
          type: item.type,
          urgency: item.urgency,
          content: item.content,
          channels: channelsForRecord,
          metadata: item.metadata,
        });

        // Step 5: Fail fast on first validation error
        if (!notificationResult.success) {
          return {
            success: false,
            error: new NotificationError(
              notificationResult.error.message,
              'VALIDATION_ERROR'
            ),
          };
        }

        // Step 6: Assemble full Notification entity
        assembled.push({
          id: createId(),
          ...notificationResult.value,
          createdAt: now,
          updatedAt: now,
        });
      }

      // Step 7: Persist all in a single bulk operation
      await repo.saveBulk(assembled);

      // Step 8: Return all created Notifications
      return { success: true, value: assembled };
    } catch {
      return {
        success: false,
        error: new NotificationError(
          'Failed to create bulk notifications',
          'SERVICE_ERROR'
        ),
      };
    }
  };
};
