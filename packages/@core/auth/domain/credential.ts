// =============================================================================
// Domain — Credential Entity
// =============================================================================
// A Credential is the proof of identity for a Principal. It encapsulates the
// secret material (hash) and metadata needed to verify that a Principal is
// who they claim to be.
//
// CredentialType determines the authentication mechanism:
//   - password: Argon2id hashed secret known only to the Principal
//   - oauth:    Identity delegated to a third-party provider
//   - api_key:  Long-lived bearer token for programmatic / machine access
//
// Design decisions:
//   - principalId is a plain text soft link — no cross-module imports
//   - Optional fields use undefined (not null) at the domain level, to keep
//     the domain layer free of database-specific null semantics
//   - All validation functions return Result<T, Error> — never throw
// =============================================================================

import { Result } from '../../../shared/lib/result';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type CredentialType = 'password' | 'oauth' | 'api_key';

export type Credential = {
  id: string;
  principalId: string;
  type: CredentialType;
  provider?: string;
  providerAccountId?: string;
  secretHash: string;
  keyPrefix?: string;
  lastUsedAt?: Date;
  expiresAt?: Date;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

// =============================================================================
// SECTION 2: VALIDATION FUNCTIONS
// =============================================================================

/**
 * Validates password strength.
 * Business rules:
 *   - Minimum 8 characters
 *   - Must contain at least one uppercase letter
 *   - Must contain at least one lowercase letter
 *   - Must contain at least one digit
 *   - Must contain at least one special character
 */
export const validatePasswordStrength = (password: string): Result<string, Error> => {
  if (!password || password.length < 8) {
    return {
      success: false,
      error: new Error('Password must be at least 8 characters long'),
    };
  }

  if (!/[A-Z]/.test(password)) {
    return {
      success: false,
      error: new Error('Password must contain at least one uppercase letter'),
    };
  }

  if (!/[a-z]/.test(password)) {
    return {
      success: false,
      error: new Error('Password must contain at least one lowercase letter'),
    };
  }

  if (!/[0-9]/.test(password)) {
    return {
      success: false,
      error: new Error('Password must contain at least one digit'),
    };
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    return {
      success: false,
      error: new Error('Password must contain at least one special character'),
    };
  }

  return { success: true, value: password };
};

/**
 * Validates an OAuth provider name.
 * Business rules:
 *   - Cannot be empty after trimming
 *   - Returns the normalized (trimmed, lowercased) provider name
 */
export const validateProvider = (provider: string): Result<string, Error> => {
  if (!provider || provider.trim().length === 0) {
    return {
      success: false,
      error: new Error('Provider cannot be empty'),
    };
  }

  return { success: true, value: provider.trim().toLowerCase() };
};

/**
 * Validates an OAuth provider account ID.
 * Business rules:
 *   - Cannot be empty after trimming
 *   - Returns the trimmed provider account ID
 */
export const validateProviderAccountId = (id: string): Result<string, Error> => {
  if (!id || id.trim().length === 0) {
    return {
      success: false,
      error: new Error('Provider account ID cannot be empty'),
    };
  }

  return { success: true, value: id.trim() };
};

/**
 * Validates a principal ID soft link.
 * Business rules:
 *   - Cannot be empty after trimming
 *   - Returns the trimmed principal ID
 */
export const validatePrincipalId = (id: string): Result<string, Error> => {
  if (!id || id.trim().length === 0) {
    return {
      success: false,
      error: new Error('Principal ID cannot be empty'),
    };
  }

  return { success: true, value: id.trim() };
};
