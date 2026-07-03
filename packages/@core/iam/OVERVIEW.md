# @core/iam

Policy evaluation and access control. Manages policies (named bundles of actions), entitlements (policy grants to principals), and runtime access evaluation using CASL.

## Owns
- Policy entity (named action bundles with PLATFORM or TENANT scope)
- Entitlement entity (links principal + policy + optional tenant)
- Access evaluation: "Can principal X do action Y in tenant Z?"
- CASL ability builder for runtime permission checks
- Delegation tracking (who granted what to whom)

## Does Not Own
- Principal identity (see @core/identity)
- Authentication (see @core/auth)
- Tenant hierarchy (see @core/tenancy — WIP)

## Status
Stable. 6 capabilities, 7 use cases. Schema: `core_iam`.
