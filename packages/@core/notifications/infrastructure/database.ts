// =============================================================================
// Notifications Module — Database Type Definition
// =============================================================================
// Defines the type of the Drizzle database instance this module requires.
//
// The consuming application creates the actual database instance using
// `drizzle()` with this module's schema and passes it to repository factories.
//
// This module does NOT create database connections — it only defines the type
// contract for dependency injection.
//
// Usage in consuming application:
//   import { drizzle } from 'drizzle-orm/node-postgres';
//   import * as notificationsSchema from '@/packages/@core/notifications/schema';
//
//   const db = drizzle(pool, { schema: notificationsSchema });
//   // db now matches NotificationsDatabase type
// =============================================================================

import { drizzle } from 'drizzle-orm/node-postgres';
import * as notificationsSchema from '../schema';

/**
 * The type of the Drizzle database instance this module requires.
 *
 * Consuming applications must create a `drizzle()` instance with the Notifications schema
 * and pass it to repository factories (makeNotificationRepository).
 *
 * This type enforces that the database instance includes:
 *   - All Notifications schema tables (notifications_notifications, notifications_preferences)
 *   - TypeScript type safety for queries
 */
export type NotificationsDatabase = ReturnType<typeof drizzle<typeof notificationsSchema>>;
