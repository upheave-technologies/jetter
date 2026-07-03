# @core/dispatch

Bidirectional communication hub. Routes outbound messages through channel adapters (email, Slack, webhook, push) and processes inbound messages through configurable handler pipelines.

## Owns
- Message entity (outbound + inbound, with delivery tracking)
- Thread entity (conversation grouping by channel + address)
- Channel adapter system (pluggable send/receive per channel)
- Production Slack adapter (send, receive, signature verification)
- Inbound routing engine (predicate-based handler matching)
- Retry logic with configurable max attempts
- Batch processing for both directions
- Provider reference correlation queries on message repository (`findByProviderRef`, `findSentBySource`)

## Does Not Own
- In-app notifications (see @core/notifications)
- Notification preferences (see @core/notifications)
- Message content templates (application concern)
- Slack workspace management, app installation, or OAuth flows (application concern)

## Status
Stable. 8 capabilities, 10 use cases, 12 repository methods. Schema: `core_dispatch`. Slack adapter is production-grade (not a stub).
