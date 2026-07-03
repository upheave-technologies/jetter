# @core/identity

Principal lifecycle management. Creates, updates, suspends, reactivates, and deactivates Principals — the agnostic identity abstraction for humans, AI agents, and system workers.

## Owns
- Principal entity (id, type, status, name, email, metadata)
- Full lifecycle: create → active → suspended → reactivated | deactivated
- Soft delete with reactivation support

## Does Not Own
- Authentication or credentials (see @core/auth)
- Permissions or access control (see @core/iam)
- Tenant membership (see @core/tenancy — WIP)

## Status
Stable. 5 capabilities, 7 use cases. Schema: `core_identity`.
