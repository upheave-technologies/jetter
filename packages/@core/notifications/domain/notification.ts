// =============================================================================
// Domain — Notification Entity
// =============================================================================
// A Notification is a directed message sent to a Principal via one or more
// declared delivery channels. The domain is intentionally agnostic about what
// the channels are — the application layer and infrastructure decide how each
// channel string maps to a concrete delivery mechanism.
//
// Design decisions:
//   - principalId is a plain string (soft link — no FK awareness in domain)
//   - type is an opaque string — application layer defines the meaning
//   - channels is a string array — order is not significant
//   - urgency is a narrowed string union that controls prioritisation logic
//   - read/readAt track consumption state without touching delivery state
//   - deletedAt uses undefined (not null) at the domain level to stay free of
//     database-specific null semantics
//   - All validation functions return Result<T, Error> — never throw
// =============================================================================

import { Result } from '../../../shared/lib/result';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type Urgency = 'low' | 'normal' | 'high' | 'urgent';

export type NotificationContent = {
  title: string;
  body: string;
  actionUrl?: string;
  context?: Record<string, unknown>;
};

export type Notification = {
  id: string;
  principalId: string;
  type: string;          // opaque string — application layer defines meaning
  urgency: Urgency;
  content: NotificationContent;
  channels: string[];    // declared delivery channel intents
  read: boolean;
  readAt?: Date;
  metadata?: Record<string, unknown>;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

// =============================================================================
// SECTION 2: VALIDATION FUNCTIONS
// =============================================================================

/**
 * Validates the content payload of a notification.
 * Business rules:
 *   - title: required, non-empty after trimming, max 200 characters
 *   - body: required, non-empty after trimming, max 2000 characters
 *   - actionUrl (if provided): non-empty and must be an absolute URL
 *     (contains "://") or a relative path (starts with "/")
 * Returns the validated content with trimmed title and body on success.
 */
export const validateContent = (
  content: NotificationContent
): Result<NotificationContent, Error> => {
  const trimmedTitle = content.title?.trim() ?? '';
  if (trimmedTitle.length === 0) {
    return {
      success: false,
      error: new Error('Notification title cannot be empty'),
    };
  }
  if (trimmedTitle.length > 200) {
    return {
      success: false,
      error: new Error('Notification title must not exceed 200 characters'),
    };
  }

  const trimmedBody = content.body?.trim() ?? '';
  if (trimmedBody.length === 0) {
    return {
      success: false,
      error: new Error('Notification body cannot be empty'),
    };
  }
  if (trimmedBody.length > 2000) {
    return {
      success: false,
      error: new Error('Notification body must not exceed 2000 characters'),
    };
  }

  if (content.actionUrl !== undefined) {
    const trimmedUrl = content.actionUrl.trim();
    if (trimmedUrl.length === 0) {
      return {
        success: false,
        error: new Error('Notification actionUrl cannot be an empty string'),
      };
    }
    const isAbsolute = trimmedUrl.includes('://');
    const isRelative = trimmedUrl.startsWith('/');
    if (!isAbsolute && !isRelative) {
      return {
        success: false,
        error: new Error(
          'Notification actionUrl must be an absolute URL (contains "://") or a relative path (starts with "/")'
        ),
      };
    }
  }

  return {
    success: true,
    value: {
      title: trimmedTitle,
      body: trimmedBody,
      ...(content.actionUrl !== undefined && { actionUrl: content.actionUrl.trim() }),
      ...(content.context !== undefined && { context: content.context }),
    },
  };
};

/**
 * Validates and narrows an arbitrary string to an Urgency level.
 * Business rules:
 *   - Must be one of: "low", "normal", "high", "urgent"
 *   - Guards against invalid enum values arriving from external input
 */
export const validateUrgency = (urgency: string): Result<Urgency, Error> => {
  const valid: Urgency[] = ['low', 'normal', 'high', 'urgent'];

  if (!valid.includes(urgency as Urgency)) {
    return {
      success: false,
      error: new Error(
        `Invalid urgency "${urgency}". Must be one of: ${valid.join(', ')}`
      ),
    };
  }

  return { success: true, value: urgency as Urgency };
};

/**
 * Validates the channels array for a notification.
 * Business rules:
 *   - Array must be non-empty (at least one delivery channel declared)
 *   - Each channel must be a non-empty string after trimming
 * Returns the validated channels on success.
 */
export const validateChannels = (channels: string[]): Result<string[], Error> => {
  if (!channels || channels.length === 0) {
    return {
      success: false,
      error: new Error('Notification must declare at least one delivery channel'),
    };
  }

  for (let i = 0; i < channels.length; i++) {
    const trimmed = channels[i]?.trim() ?? '';
    if (trimmed.length === 0) {
      return {
        success: false,
        error: new Error(`Channel at index ${i} cannot be an empty string`),
      };
    }
  }

  return { success: true, value: channels };
};

// =============================================================================
// SECTION 3: FACTORY FUNCTION
// =============================================================================

/**
 * Validates and assembles the core fields needed to create a new Notification.
 * Composes all relevant validation rules and returns validated fields only.
 * The calling use case is responsible for appending id, createdAt, and updatedAt.
 *
 * Business rules applied (in order):
 *   1. urgency must be a valid Urgency value
 *   2. content must pass all structural validations
 *   3. channels array must be non-empty with no blank entries
 */
export const createNotification = (input: {
  principalId: string;
  type: string;
  urgency: string;
  content: NotificationContent;
  channels: string[];
  metadata?: Record<string, unknown>;
}): Result<Omit<Notification, 'id' | 'createdAt' | 'updatedAt'>, Error> => {
  const urgencyResult = validateUrgency(input.urgency);
  if (!urgencyResult.success) return urgencyResult;

  const contentResult = validateContent(input.content);
  if (!contentResult.success) return contentResult;

  const channelsResult = validateChannels(input.channels);
  if (!channelsResult.success) return channelsResult;

  return {
    success: true,
    value: {
      principalId: input.principalId,
      type: input.type,
      urgency: urgencyResult.value,
      content: contentResult.value,
      channels: channelsResult.value,
      read: false,
      readAt: undefined,
      metadata: input.metadata,
    },
  };
};

// =============================================================================
// SECTION 4: PURE TRANSFORMATIONS
// =============================================================================

/**
 * Returns a new Notification with read = true and readAt set to the given date.
 * Pure transformation — the input notification is never mutated.
 * Always succeeds: no Result wrapper needed.
 */
export const markAsRead = (notification: Notification, at: Date): Notification => {
  return {
    ...notification,
    read: true,
    readAt: at,
  };
};
