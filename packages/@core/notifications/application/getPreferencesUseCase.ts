// =============================================================================
// Application — Get Preferences Use Case
// =============================================================================
// Returns the NotificationPreference record for a Principal.
// Auto-creates a default preference record on first access (lazy initialisation).
//
// Flow:
//   1. Call repo.getPreferences()
//   2. If null (first access): assemble a default NotificationPreference entity,
//      persist via repo.savePreferences(), return the created record
//   3. Otherwise return the existing record
// =============================================================================

import { createId } from '@paralleldrive/cuid2';
import { Result } from '../../../shared/lib/result';
import { NotificationPreference } from '../domain/notificationPreference';
import { getDefaultPreferences } from '../domain/notificationPreference';
import { INotificationRepository } from '../domain/notificationRepository';
import { NotificationError } from './notificationError';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type GetPreferencesInput = {
  principalId: string;
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the getPreferences use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeGetPreferencesUseCase = (repo: INotificationRepository) => {
  return async (
    data: GetPreferencesInput
  ): Promise<Result<NotificationPreference, NotificationError>> => {
    try {
      // Step 1: Fetch existing preference record
      const existing = await repo.getPreferences(data.principalId);

      // Step 2: First access — auto-create with system defaults
      if (existing === null) {
        const now = new Date();
        const defaultPref: NotificationPreference = {
          id: createId(),
          principalId: data.principalId,
          preferences: getDefaultPreferences(),
          createdAt: now,
          updatedAt: now,
        };

        await repo.savePreferences(defaultPref);
        return { success: true, value: defaultPref };
      }

      // Step 3: Return existing record
      return { success: true, value: existing };
    } catch {
      return {
        success: false,
        error: new NotificationError(
          'Failed to retrieve notification preferences',
          'SERVICE_ERROR'
        ),
      };
    }
  };
};
