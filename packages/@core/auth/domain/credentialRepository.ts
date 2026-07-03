// =============================================================================
// Domain — Credential Repository Interface
// =============================================================================
// This is the CONTRACT for credential persistence operations.
// The domain layer defines WHAT it needs; the infrastructure layer provides
// the concrete Drizzle implementation.
//
// All read operations must apply the Zombie Shield (filter deletedAt IS NULL)
// unless specifically retrieving soft-deleted records for audit purposes.
// =============================================================================

import { Credential, CredentialType } from './credential';

export type ICredentialRepository = {
  /**
   * Find a credential by its unique ID.
   * Returns null if not found or soft-deleted.
   */
  findById: (id: string) => Promise<Credential | null>;

  /**
   * Find all active credentials for a Principal of a specific type.
   * Returns empty array if none found.
   */
  findByPrincipalAndType: (principalId: string, type: CredentialType) => Promise<Credential[]>;

  /**
   * Find an active credential by OAuth provider and provider account ID.
   * Returns null if not found or soft-deleted.
   */
  findByProviderAccount: (provider: string, providerAccountId: string) => Promise<Credential | null>;

  /**
   * Find all active credentials matching a given API key prefix.
   * Used for O(1) bucket lookup before full hash verification.
   */
  findByKeyPrefix: (keyPrefix: string) => Promise<Credential[]>;

  /**
   * Find all active credentials belonging to a Principal.
   * Returns empty array if none found.
   */
  findAllByPrincipal: (principalId: string) => Promise<Credential[]>;

  /**
   * Check whether a Principal has at least one active credential.
   * Optionally filtered by credential type.
   */
  hasActiveCredential: (principalId: string, type?: CredentialType) => Promise<boolean>;

  /**
   * Persist a new credential to storage.
   */
  save: (credential: Credential) => Promise<void>;

  /**
   * Update the lastUsedAt timestamp for a credential.
   */
  updateLastUsedAt: (id: string) => Promise<void>;

  /**
   * Soft-delete a single credential by ID.
   * Never hard-deletes — preserves audit trail.
   */
  softDelete: (id: string) => Promise<void>;

  /**
   * Soft-delete ALL active credentials for a Principal.
   * Used when a Principal account is deactivated or deleted.
   */
  softDeleteAllByPrincipal: (principalId: string) => Promise<void>;
};
