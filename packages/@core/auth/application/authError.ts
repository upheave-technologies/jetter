// =============================================================================
// Application — Auth Error
// =============================================================================
// Custom error class for Auth module operations.
// Includes a structured error code for programmatic handling by consumers.
//
// Error codes:
//   CREDENTIAL_EXISTS        — A credential of this type already exists for the Principal
//   CREDENTIAL_NOT_FOUND     — No active credential matched the lookup criteria
//   INVALID_PASSWORD         — Password does not match the stored hash
//   PASSWORD_TOO_WEAK        — Password fails strength validation rules
//   VERIFICATION_FAILED      — Generic credential verification failure
//   EXPIRED_CREDENTIAL       — Credential has passed its expiresAt timestamp
//   PROVIDER_ALREADY_LINKED  — OAuth provider account is already linked to a Principal
//   VALIDATION_ERROR         — Input failed domain-level validation
//   SERVICE_ERROR            — Unexpected infrastructure or external service failure
// =============================================================================

export class AuthError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'AuthError';
  }
}
