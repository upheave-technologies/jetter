// =============================================================================
// Domain — NotificationPreference Entity
// =============================================================================
// NotificationPreference stores a Principal's opt-out settings for notification
// delivery. The model is intentionally opt-out: if no preference record exists
// for a channel, delivery proceeds as normal. Principals must explicitly disable
// a channel or notification type to suppress it.
//
// Resolution order (most specific wins):
//   1. Type-specific override: preferences[channel].types[notificationType]
//   2. Channel-level global:   preferences[channel].enabled
//   3. Default (no record):    true  — opt-out model
//
// Design decisions:
//   - NotificationPreferences is keyed by channel name (string) — agnostic of
//     what channels exist; infrastructure defines valid channel names
//   - ChannelPreference.types is optional — omitting it means no type overrides
//   - mergePreferences deep-merges to allow partial channel updates without
//     wiping unrelated channel preferences or type overrides
//   - All mutation helpers return new objects — zero mutation of inputs
//   - validatePreferences performs structural checks only; it does not validate
//     that channel names or notification types are known to the system
// =============================================================================

import { Result } from '../../../shared/lib/result';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

/**
 * Per-channel preference: is this channel globally enabled?
 * types: optional per-notification-type overrides (type string → enabled boolean).
 * Type-specific overrides take precedence over the channel-level enabled flag.
 */
export type ChannelPreference = {
  enabled: boolean;
  types?: Record<string, boolean>;
};

/**
 * The full preferences structure for a Principal, keyed by channel name.
 * Channels not present in this record are implicitly enabled (opt-out model).
 */
export type NotificationPreferences = Record<string, ChannelPreference>;

/**
 * The full preference entity persisted in the database.
 */
export type NotificationPreference = {
  id: string;
  principalId: string;
  preferences: NotificationPreferences;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

// =============================================================================
// SECTION 2: PURE FUNCTIONS
// =============================================================================

/**
 * Returns the system-wide default preferences applied when no explicit
 * preference record exists for a Principal.
 * Opt-out model: all standard channels active unless the Principal disables them.
 */
export const getDefaultPreferences = (): NotificationPreferences => ({
  'in-app': { enabled: true },
  'email': { enabled: true },
});

/**
 * Determines whether a notification should be delivered on the given channel
 * for the given notification type, according to the Principal's preferences.
 *
 * Resolution logic (most-specific wins):
 *   1. No preference record for the channel → return true (opt-out default)
 *   2. Type-specific override exists for this channel+type → return that boolean
 *   3. Otherwise → return the channel-level enabled flag
 */
export const shouldSendNotification = (
  preferences: NotificationPreferences,
  channel: string,
  notificationType: string
): boolean => {
  const channelPref = preferences[channel];

  // No record for this channel — opt-out model defaults to enabled
  if (channelPref === undefined) {
    return true;
  }

  // Check for a type-specific override
  const typeOverride = channelPref.types?.[notificationType];
  if (typeOverride !== undefined) {
    return typeOverride;
  }

  // Fall back to the channel-level enabled flag
  return channelPref.enabled;
};

/**
 * Deep-merges an update into existing preferences without mutating either input.
 *
 * Merge rules:
 *   - Channels not mentioned in update are preserved unchanged
 *   - For each channel in update, the channel's `enabled` flag is replaced
 *   - The `types` sub-record is merged (not replaced): existing type overrides
 *     not present in the update are preserved
 */
export const mergePreferences = (
  existing: NotificationPreferences,
  update: Partial<NotificationPreferences>
): NotificationPreferences => {
  const result: NotificationPreferences = { ...existing };

  for (const channel of Object.keys(update)) {
    const updateChannel = update[channel];
    if (updateChannel === undefined) continue;

    const existingChannel = existing[channel];

    result[channel] = {
      enabled: updateChannel.enabled,
      // Deep-merge the types sub-record: start from existing, overlay with update
      ...(existingChannel?.types !== undefined || updateChannel.types !== undefined
        ? {
            types: {
              ...(existingChannel?.types ?? {}),
              ...(updateChannel.types ?? {}),
            },
          }
        : {}),
    };
  }

  return result;
};

/**
 * Validates the structural constraints of a NotificationPreferences object.
 * Business rules:
 *   - Must be a non-null object
 *   - Each key (channel name) must be a non-empty string
 *   - Each value must have `enabled` as a boolean
 *   - If a `types` sub-record exists, each key must be a non-empty string
 *     and each value must be a boolean
 * Returns the validated preferences unchanged on success.
 */
export const validatePreferences = (
  preferences: NotificationPreferences
): Result<NotificationPreferences, Error> => {
  if (preferences === null || typeof preferences !== 'object' || Array.isArray(preferences)) {
    return {
      success: false,
      error: new Error('Preferences must be a non-null object'),
    };
  }

  for (const channelName of Object.keys(preferences)) {
    if (channelName.trim().length === 0) {
      return {
        success: false,
        error: new Error('Channel name keys in preferences must be non-empty strings'),
      };
    }

    const channelPref = preferences[channelName];

    if (typeof channelPref.enabled !== 'boolean') {
      return {
        success: false,
        error: new Error(
          `Channel "${channelName}" preferences must have an "enabled" boolean`
        ),
      };
    }

    if (channelPref.types !== undefined) {
      if (
        channelPref.types === null ||
        typeof channelPref.types !== 'object' ||
        Array.isArray(channelPref.types)
      ) {
        return {
          success: false,
          error: new Error(
            `Channel "${channelName}" types overrides must be a non-null object`
          ),
        };
      }

      for (const typeName of Object.keys(channelPref.types)) {
        if (typeName.trim().length === 0) {
          return {
            success: false,
            error: new Error(
              `Type override keys in channel "${channelName}" must be non-empty strings`
            ),
          };
        }

        if (typeof channelPref.types[typeName] !== 'boolean') {
          return {
            success: false,
            error: new Error(
              `Type override "${typeName}" in channel "${channelName}" must be a boolean`
            ),
          };
        }
      }
    }
  }

  return { success: true, value: preferences };
};
