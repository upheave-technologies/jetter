// =============================================================================
// Notifications Module — Drizzle Enums
// =============================================================================
// PostgreSQL enum types for the Notifications module.
//
// Urgency represents the priority level of a notification:
//   - low:    Informational, non-time-sensitive (e.g., weekly digest items)
//   - normal: Standard notification, default for most events
//   - high:   Important, should surface prominently in the feed
//   - urgent: Requires immediate attention, may trigger push/SMS channels
// =============================================================================

import { pgEnum } from 'drizzle-orm/pg-core';

export const notificationsUrgency = pgEnum('notifications_urgency', ['low', 'normal', 'high', 'urgent']);
