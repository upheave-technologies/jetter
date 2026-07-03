// =============================================================================
// Notifications Module — Schema Barrel Export
// =============================================================================
// This is the public API of the Notifications module's data model. Consuming
// applications import from here to compose their database schema.
//
// Usage in a consuming application's drizzle.config.ts:
//   schema: ['./packages/@core/notifications/schema/index.ts']
//
// Usage in application code:
//   import { notificationsNotifications, notificationsUrgency } from '@/packages/@core/notifications/schema';
// =============================================================================

export { notificationsNotifications } from './notifications';
export { notificationsPreferences } from './preferences';
export { notificationsUrgency } from './enums';
