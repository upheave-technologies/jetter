// =============================================================================
// Application — Identity Error
// =============================================================================
// Custom error class for Identity module operations.
// Includes a structured error code for programmatic handling by consumers.
//
// Error codes:
//   PRINCIPAL_NOT_FOUND           — No active Principal matched the lookup criteria
//   EMAIL_ALREADY_EXISTS          — A Principal with this email address already exists
//   VALIDATION_ERROR              — Input failed domain-level validation
//   INVALID_STATUS_TRANSITION     — The requested status change is not permitted
//   PRINCIPAL_ALREADY_DEACTIVATED — Principal exists but has been permanently deactivated
//   SERVICE_ERROR                 — Unexpected infrastructure or external service failure
// =============================================================================

export class IdentityError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'IdentityError';
  }
}
