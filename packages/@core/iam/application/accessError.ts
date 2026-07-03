// =============================================================================
// Application — Access Error
// =============================================================================
// Custom error class for IAM/Access operations.
// Includes an error code for programmatic error handling.
//
// Adapted from reference code: application/rbacError.ts
// =============================================================================

export class AccessError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'AccessError';
  }
}
