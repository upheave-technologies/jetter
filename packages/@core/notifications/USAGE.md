# Usage — @core/notifications

## Setup

Wire the repository in your composition root:

```ts
import {
  makeNotificationRepository,
  makeCreateNotificationUseCase,
  makeGetUnreadCountUseCase,
  makeMarkAsReadUseCase,
  makeMarkAllAsReadUseCase,
} from '@core/notifications'

const notificationRepo = makeNotificationRepository(db)

const createNotification = makeCreateNotificationUseCase(notificationRepo)
const getUnreadCount = makeGetUnreadCountUseCase(notificationRepo)
const markAsRead = makeMarkAsReadUseCase(notificationRepo)
const markAllAsRead = makeMarkAllAsReadUseCase(notificationRepo)
```

## I need to show in-app notifications to users

> Notifications are stored in-app records linked to a **Principal** (user). They have urgency levels and can be grouped by type.

```ts
// Requires: a Principal must already exist (identity:principal:exists)
const result = await createNotification({
  principalId: principal.id,          // the Principal receiving the notification
  type: 'campaign.published',
  urgency: 'normal',                  // urgency level: 'critical' | 'high' | 'normal' | 'low'
  content: {
    title: 'Campaign Published',
    body: 'Your campaign "Summer Sale" is now live.',
    actionUrl: '/campaigns/abc123',
  },
  channels: ['in_app'],   // filtered against the Principal's notification preferences
})

if (!result.success) {
  // 'VALIDATION_ERROR' | 'SERVICE_ERROR'
  throw new Error(result.error.message)
}
```

## I need to show an unread badge and mark notifications as read

```ts
// Total unread count for a principal
const countResult = await getUnreadCount({ principalId: principal.id })
// countResult.value — number

// Scope to a specific urgency: 'critical', 'high', 'normal', 'low'
const urgentCount = await getUnreadCount({
  principalId: principal.id,
  urgency: 'critical',
})

// Mark a single notification as read (ownership is verified internally)
await markAsRead({
  principalId: principal.id,
  notificationId: notification.id,
})

// Mark all unread notifications as read at once
await markAllAsRead({ principalId: principal.id })
```
