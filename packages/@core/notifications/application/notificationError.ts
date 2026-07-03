// =============================================================================
// Application — Notification Module Error
// =============================================================================
// Module-scoped error class for all notification use case failures.
//
// Error codes:
//   NOTIFICATION_NOT_FOUND — no active notification with this ID
//   VALIDATION_ERROR        — input failed domain validation
//   UNAUTHORIZED            — principal does not own this notification
//   SERVICE_ERROR           — unexpected infrastructure failure
// =============================================================================

export class NotificationError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'NotificationError';
  }
}
