// =============================================================================
// Domain — Principal Entity
// =============================================================================
// A Principal is any actor that can authenticate and take actions within the
// system. This is the identity anchor — everything else (sessions, credentials,
// memberships) hangs off it.
//
// PrincipalType determines the nature of the actor:
//   - human:  A real person interacting via UI or API
//   - agent:  An autonomous AI or bot acting on behalf of a human or system
//   - system: An internal service account for machine-to-machine communication
//
// PrincipalStatus governs what the Principal is allowed to do:
//   - active:      Normal operation, full access per permissions
//   - suspended:   Temporarily restricted — can be reinstated
//   - deactivated: Permanently disabled — cannot be reinstated
//
// Design decisions:
//   - email is optional: system/agent principals need no email address
//   - metadata is a flexible bag for module-specific data (e.g. avatar URL,
//     locale) — capped at 64KB to prevent abuse
//   - deletedAt uses undefined (not null) at the domain level to stay free of
//     database-specific null semantics
//   - All validation functions return Result<T, Error> — never throw
// =============================================================================

import { Result } from '../../../shared/lib/result';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type PrincipalType = 'human' | 'agent' | 'system';

export type PrincipalStatus = 'active' | 'suspended' | 'deactivated';

export type Principal = {
  id: string;
  type: PrincipalType;
  status: PrincipalStatus;
  name: string;
  email?: string;
  metadata?: Record<string, unknown>;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

// =============================================================================
// SECTION 2: VALIDATION FUNCTIONS
// =============================================================================

/**
 * Validates a Principal's display name.
 * Business rules:
 *   - Cannot be empty after trimming whitespace
 *   - Maximum 200 characters (after trimming)
 *   - Returns the trimmed name on success
 */
export const validatePrincipalName = (name: string): Result<string, Error> => {
  if (!name || name.trim().length === 0) {
    return {
      success: false,
      error: new Error('Principal name cannot be empty'),
    };
  }

  const trimmed = name.trim();

  if (trimmed.length > 200) {
    return {
      success: false,
      error: new Error('Principal name must not exceed 200 characters'),
    };
  }

  return { success: true, value: trimmed };
};

/**
 * Validates a Principal's email address (structural check only).
 * Business rules:
 *   - Must contain an "@" character
 *   - Maximum 320 characters per RFC 5321
 *   - Returns the lowercased, trimmed email on success
 *
 * Note: This is a structural check only. It does not verify deliverability
 * or DNS records — that responsibility belongs to an external service.
 */
export const validatePrincipalEmail = (email: string): Result<string, Error> => {
  if (!email || email.trim().length === 0) {
    return {
      success: false,
      error: new Error('Email cannot be empty'),
    };
  }

  const normalized = email.trim().toLowerCase();

  if (normalized.length > 320) {
    return {
      success: false,
      error: new Error('Email must not exceed 320 characters (RFC 5321)'),
    };
  }

  if (!normalized.includes('@')) {
    return {
      success: false,
      error: new Error('Email must contain an "@" character'),
    };
  }

  return { success: true, value: normalized };
};

/**
 * Validates and narrows an arbitrary string to a PrincipalType.
 * Business rules:
 *   - Must be one of: "human", "agent", "system"
 *   - Guards against invalid enum values arriving from external input
 *     (e.g. HTTP request bodies, CSV imports)
 */
export const validatePrincipalType = (type: string): Result<PrincipalType, Error> => {
  const valid: PrincipalType[] = ['human', 'agent', 'system'];

  if (!valid.includes(type as PrincipalType)) {
    return {
      success: false,
      error: new Error(
        `Invalid principal type "${type}". Must be one of: ${valid.join(', ')}`
      ),
    };
  }

  return { success: true, value: type as PrincipalType };
};

/**
 * Validates a status transition for a Principal.
 * Business rules:
 *   - active      → suspended     (allowed: temporary restriction)
 *   - active      → deactivated   (allowed: permanent disable)
 *   - suspended   → active        (allowed: reinstatement)
 *   - suspended   → deactivated   (allowed: escalate to permanent)
 *   - deactivated → *             (never allowed: permanent state)
 *   - X           → X             (not allowed: no-op transitions are rejected)
 *
 * Returns the target status on success, a descriptive error on failure.
 */
export const validateStatusTransition = (
  current: PrincipalStatus,
  target: PrincipalStatus
): Result<PrincipalStatus, Error> => {
  if (current === target) {
    return {
      success: false,
      error: new Error(`Principal is already ${current}`),
    };
  }

  if (current === 'deactivated') {
    return {
      success: false,
      error: new Error('Cannot reactivate a deactivated principal'),
    };
  }

  // At this point current is either 'active' or 'suspended'.
  // Both may transition to 'suspended', 'active', or 'deactivated'
  // with the constraints already eliminated above (same-state and deactivated→*).
  // The remaining combinations are all valid per the rules above.
  return { success: true, value: target };
};

/**
 * Validates a metadata payload attached to a Principal.
 * Business rules:
 *   - Serialized JSON must not exceed 64KB (65,536 bytes)
 *   - Returns the metadata object unchanged on success
 *
 * Note: The 64KB cap prevents a single principal from storing unbounded data
 * in a shared database column.
 */
export const validateMetadata = (
  metadata: Record<string, unknown>
): Result<Record<string, unknown>, Error> => {
  const serialized = JSON.stringify(metadata);

  if (serialized.length > 65536) {
    return {
      success: false,
      error: new Error(
        'Metadata must not exceed 64KB when serialized'
      ),
    };
  }

  return { success: true, value: metadata };
};

// =============================================================================
// SECTION 3: FACTORY FUNCTION
// =============================================================================

/**
 * Validates and assembles the core fields needed to create a new Principal.
 * Composes all relevant validation rules and returns validated fields only.
 * The calling use case is responsible for appending id, status, and timestamps.
 *
 * Business rules applied (in order):
 *   1. type must be a valid PrincipalType
 *   2. name must be non-empty and ≤ 200 chars
 *   3. email (if provided) must be structurally valid and ≤ 320 chars
 *   4. metadata (if provided) must serialize within 64KB
 */
export const createPrincipal = (input: {
  type: string;
  name: string;
  email?: string;
  metadata?: Record<string, unknown>;
}): Result<
  {
    type: PrincipalType;
    name: string;
    email?: string;
    metadata?: Record<string, unknown>;
  },
  Error
> => {
  const typeResult = validatePrincipalType(input.type);
  if (!typeResult.success) return typeResult;

  const nameResult = validatePrincipalName(input.name);
  if (!nameResult.success) return nameResult;

  let validatedEmail: string | undefined;
  if (input.email !== undefined) {
    const emailResult = validatePrincipalEmail(input.email);
    if (!emailResult.success) return emailResult;
    validatedEmail = emailResult.value;
  }

  let validatedMetadata: Record<string, unknown> | undefined;
  if (input.metadata !== undefined) {
    const metadataResult = validateMetadata(input.metadata);
    if (!metadataResult.success) return metadataResult;
    validatedMetadata = metadataResult.value;
  }

  return {
    success: true,
    value: {
      type: typeResult.value,
      name: nameResult.value,
      ...(validatedEmail !== undefined && { email: validatedEmail }),
      ...(validatedMetadata !== undefined && { metadata: validatedMetadata }),
    },
  };
};
