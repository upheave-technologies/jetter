# @core/notifications

In-app notification registry. Creates, stores, and tracks notifications with urgency levels, read state, and per-principal delivery preferences.

## Owns
- Notification entity (type, urgency, content, channels, read state)
- Notification preferences per principal
- Unread counts and pagination
- Bulk notification creation
- Mark-as-read (single and bulk)

## Does Not Own
- Message delivery to external channels (see @core/dispatch)
- Principal identity (see @core/identity)
- Push/email/SMS delivery (see @core/dispatch)

## Status
Stable. 5 capabilities, 9 use cases. Schema: `core_notifications`.
