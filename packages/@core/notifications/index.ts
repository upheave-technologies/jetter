// =============================================================================
// Notifications Module — Public API (Barrel Export)
// =============================================================================
// This is the single entry point for consuming applications to import from
// the Notifications module. It exports only the public API, hiding internal
// implementation details such as INotificationRepository, mapping functions,
// validation functions, and internal pure domain helpers.
//
// Usage in consuming application:
//   import {
//     type NotificationsDatabase,
//     makeNotificationRepository,
//     makeCreateNotificationUseCase,
//     makeGetNotificationsUseCase,
//     type Notification,
//     type Urgency,
//     NotificationError,
//   } from '@core/notifications';
// =============================================================================

// -----------------------------------------------------------------------------
// Schema (for consuming apps to compose their database)
// -----------------------------------------------------------------------------
export * from './schema';

// -----------------------------------------------------------------------------
// Database Type (for typing the db instance)
// -----------------------------------------------------------------------------
export type { NotificationsDatabase } from './infrastructure/database';

// -----------------------------------------------------------------------------
// Repository Factory (for creating repository instances)
// -----------------------------------------------------------------------------
export { makeNotificationRepository } from './infrastructure/repositories/DrizzleNotificationRepository';

// -----------------------------------------------------------------------------
// Use Case Factories (for creating use case instances)
// -----------------------------------------------------------------------------
export { makeCreateNotificationUseCase } from './application/createNotificationUseCase';
export { makeCreateBulkNotificationsUseCase } from './application/createBulkNotificationsUseCase';
export { makeGetNotificationsUseCase } from './application/getNotificationsUseCase';
export { makeGetNotificationCountsUseCase } from './application/getNotificationCountsUseCase';
export { makeGetUnreadCountUseCase } from './application/getUnreadCountUseCase';
export { makeMarkAsReadUseCase } from './application/markAsReadUseCase';
export { makeMarkAllAsReadUseCase } from './application/markAllAsReadUseCase';
export { makeGetPreferencesUseCase } from './application/getPreferencesUseCase';
export { makeUpdatePreferencesUseCase } from './application/updatePreferencesUseCase';

// -----------------------------------------------------------------------------
// Domain Types (for consuming apps to use in their type signatures)
// -----------------------------------------------------------------------------
export type { Notification, Urgency, NotificationContent } from './domain/notification';
export type { NotificationPreference, NotificationPreferences } from './domain/notificationPreference';
export type {
  INotificationRepository,
  NotificationCursor,
  PaginatedNotifications,
  NotificationFilter,
  NotificationCounts,
} from './domain/notificationRepository';

// -----------------------------------------------------------------------------
// Error Types (for consuming apps to handle errors)
// -----------------------------------------------------------------------------
export { NotificationError } from './application/notificationError';
