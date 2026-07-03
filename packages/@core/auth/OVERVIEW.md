# @core/auth

Credential management and verification. Handles three credential types — passwords (Argon2id), OAuth providers, and API keys — with timing-safe verification and O(1) key lookup.

## Owns
- Credential entity (password, OAuth, API key)
- Credential lifecycle: create, verify, revoke
- Password changes with current-password verification
- API key generation with prefix-based lookup

## Does Not Own
- Principal identity (see @core/identity — auth links credentials TO principals)
- Sessions or tokens (see @core/session — WIP)
- Access control or permissions (see @core/iam)

## Status
Stable. 9 capabilities, 10 use cases. Schema: `core_auth`.
