// =============================================================================
// Application — Update Preferences Use Case
// =============================================================================
// Deep-merges a preference update into the Principal's existing preferences,
// validates the result, and persists the updated record.
//
// Flow:
//   1. Fetch existing preference record via repo.getPreferences()
//   2. If null: auto-create defaults (same lazy-init as getPreferences)
//   3. Deep-merge update into existing preferences via mergePreferences()
//   4. Validate merged preferences via validatePreferences() → VALIDATION_ERROR
//   5. Assemble updated NotificationPreference with new preferences and updatedAt
//   6. Persist via repo.savePreferences() (upsert semantics)
//   7. Return updated NotificationPreference
// =============================================================================

import { createId } from '@paralleldrive/cuid2';
import { Result } from '../../../shared/lib/result';
import {
  NotificationPreference,
  NotificationPreferences,
  getDefaultPreferences,
  mergePreferences,
  validatePreferences,
} from '../domain/notificationPreference';
import { INotificationRepository } from '../domain/notificationRepository';
import { NotificationError } from './notificationError';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type UpdatePreferencesInput = {
  principalId: string;
  update: NotificationPreferences;
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the updatePreferences use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeUpdatePreferencesUseCase = (repo: INotificationRepository) => {
  return async (
    data: UpdatePreferencesInput
  ): Promise<Result<NotificationPreference, NotificationError>> => {
    try {
      // Step 1: Fetch existing preference record
      const existing = await repo.getPreferences(data.principalId);

      // Step 2: Auto-create defaults on first access if no record exists
      const now = new Date();
      const baseRecord: NotificationPreference = existing ?? {
        id: createId(),
        principalId: data.principalId,
        preferences: getDefaultPreferences(),
        createdAt: now,
        updatedAt: now,
      };

      // Step 3: Deep-merge update into existing preferences
      const merged = mergePreferences(baseRecord.preferences, data.update);

      // Step 4: Validate the merged preferences
      const validationResult = validatePreferences(merged);
      if (!validationResult.success) {
        return {
          success: false,
          error: new NotificationError(
            validationResult.error.message,
            'VALIDATION_ERROR'
          ),
        };
      }

      // Step 5: Assemble updated record with new preferences and timestamp
      const updated: NotificationPreference = {
        ...baseRecord,
        preferences: validationResult.value,
        updatedAt: new Date(),
      };

      // Step 6: Persist (upsert semantics — creates if new, updates if existing)
      await repo.savePreferences(updated);

      // Step 7: Return updated NotificationPreference
      return { success: true, value: updated };
    } catch {
      return {
        success: false,
        error: new NotificationError(
          'Failed to update notification preferences',
          'SERVICE_ERROR'
        ),
      };
    }
  };
};
