// =============================================================================
// Application — Create Notification Use Case
// =============================================================================
// Orchestrates the creation of a single Notification for a Principal.
//
// Flow:
//   1. Fetch preferences for the Principal via repo.getPreferences()
//   2. Resolve effective channels: filter declared channels using
//      shouldSendNotification() against the Principal's preferences
//      (or system defaults if no preference record exists)
//   3. Call createNotification() with resolved channels for domain validation
//   4. If validation fails → return VALIDATION_ERROR
//   5. Assemble full Notification with cuid2 id and timestamps
//   6. Persist via repo.save()
//   7. Return the created Notification
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

export type CreateNotificationInput = {
  principalId: string;
  type: string;
  urgency: string;
  content: NotificationContent;
  channels: string[];
  metadata?: Record<string, unknown>;
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the createNotification use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeCreateNotificationUseCase = (repo: INotificationRepository) => {
  return async (
    data: CreateNotificationInput
  ): Promise<Result<Notification, NotificationError>> => {
    try {
      // Step 1: Fetch preferences (use defaults when no preference record exists)
      const prefRecord = await repo.getPreferences(data.principalId);
      const preferences = prefRecord?.preferences ?? getDefaultPreferences();

      // Step 2: Resolve effective channels based on Principal's preferences
      const resolvedChannels = data.channels.filter((channel) =>
        shouldSendNotification(preferences, channel, data.type)
      );

      // Step 3: Validate via domain factory using resolved channels
      // Per design: still create the notification even if all channels are suppressed.
      // The channels stored on the notification are the resolved set.
      const channelsForRecord =
        resolvedChannels.length > 0 ? resolvedChannels : data.channels;

      const notificationResult = createNotification({
        principalId: data.principalId,
        type: data.type,
        urgency: data.urgency,
        content: data.content,
        channels: channelsForRecord,
        metadata: data.metadata,
      });

      if (!notificationResult.success) {
        return {
          success: false,
          error: new NotificationError(
            notificationResult.error.message,
            'VALIDATION_ERROR'
          ),
        };
      }

      // Step 4–5: Assemble full Notification entity with id and timestamps
      const now = new Date();
      const notification: Notification = {
        id: createId(),
        ...notificationResult.value,
        createdAt: now,
        updatedAt: now,
      };

      // Step 6: Persist
      await repo.save(notification);

      // Step 7: Return created Notification
      return { success: true, value: notification };
    } catch {
      return {
        success: false,
        error: new NotificationError(
          'Failed to create notification',
          'SERVICE_ERROR'
        ),
      };
    }
  };
};
