// =============================================================================
// Auth Module — Drizzle Enums
// =============================================================================
// PostgreSQL enum types for the Auth module.
//
// CredentialType represents the mechanism used to authenticate a Principal:
//   - password: A hashed secret known only to the Principal (Argon2id)
//   - oauth:    Delegated identity from a third-party OAuth provider
//   - api_key:  Long-lived bearer token for programmatic access
// =============================================================================

import { pgEnum } from 'drizzle-orm/pg-core';

export const authCredentialType = pgEnum('auth_credential_type', ['password', 'oauth', 'api_key']);
