// =============================================================================
// Domain — Principal Repository Interface
// =============================================================================
// This is the CONTRACT for Principal persistence operations.
// The domain layer defines WHAT it needs; the infrastructure layer provides
// the concrete Drizzle implementation.
//
// Zombie Shield
// -------------
// All read operations filter out soft-deleted records (deletedAt IS NULL)
// by default. This prevents "zombie" principals — records that appear deleted
// to the system but can still be accidentally loaded — from surfacing in
// normal application flows.
//
// The one deliberate exception is findByIdIncludingDeleted. It bypasses the
// Zombie Shield intentionally so that the deactivate use case can distinguish
// between two different failure states:
//   - Principal does not exist at all          → PRINCIPAL_NOT_FOUND
//   - Principal exists but is already deleted  → PRINCIPAL_ALREADY_DEACTIVATED
//
// Without this method, both cases would appear identical (null return), and
// the use case could not return the correct error to the caller.
// =============================================================================

import { Principal } from './principal';

export type IPrincipalRepository = {
  /**
   * Find an active Principal by its unique ID.
   * Returns null if not found or soft-deleted (Zombie Shield active).
   */
  findById: (id: string) => Promise<Principal | null>;

  /**
   * Find an active Principal by email address (case-insensitive).
   * Returns null if not found or soft-deleted (Zombie Shield active).
   */
  findByEmail: (email: string) => Promise<Principal | null>;

  /**
   * Find a Principal by ID regardless of its soft-delete state.
   * INTENTIONALLY bypasses the Zombie Shield.
   *
   * Use this only when the caller needs to differentiate between
   * "never existed" and "exists but was soft-deleted". The primary
   * use case is the deactivate flow, which must return a distinct
   * PRINCIPAL_ALREADY_DEACTIVATED error rather than PRINCIPAL_NOT_FOUND.
   */
  findByIdIncludingDeleted: (id: string) => Promise<Principal | null>;

  /**
   * Persist a new Principal to storage.
   */
  save: (principal: Principal) => Promise<void>;

  /**
   * Update an existing Principal in storage.
   * The caller is responsible for bumping updatedAt before passing the entity.
   */
  update: (principal: Principal) => Promise<void>;

  /**
   * Soft-delete a Principal by setting its deletedAt timestamp.
   * Never hard-deletes — preserves audit trail and referential integrity.
   */
  softDelete: (id: string) => Promise<void>;

  /**
   * Return a page of active Principals ordered by createdAt DESC then id DESC
   * for stable cursor-free pagination.
   * ZOMBIE SHIELD: Filters out soft-deleted principals.
   */
  findMany: (options: { limit: number; offset: number }) => Promise<Principal[]>;

  /**
   * Return the total count of active (non-soft-deleted) Principals.
   * ZOMBIE SHIELD: Filters out soft-deleted principals.
   */
  countAll: () => Promise<number>;

  /**
   * Find all active Principals whose metadata contains { seed: true }.
   * Used by the playground reset flow to identify principals that were
   * created by the sample-member seeder and can be safely wiped.
   * ZOMBIE SHIELD: Filters out soft-deleted principals.
   */
  findSeeded: () => Promise<Principal[]>;

  /**
   * Hard-delete multiple Principals by their IDs.
   * INTENTIONAL BYPASS of soft-delete — for playground reset only.
   * Permanently removes rows from the database. Use only when the caller
   * has already ensured no FK-constrained rows in other tables reference
   * these principals (e.g. role assignments wiped first).
   */
  hardDeleteMany: (ids: string[]) => Promise<void>;
};
