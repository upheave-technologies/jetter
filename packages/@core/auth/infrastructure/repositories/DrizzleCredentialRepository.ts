// =============================================================================
// Infrastructure — Drizzle Credential Repository
// =============================================================================
// Concrete implementation of ICredentialRepository using Drizzle ORM.
//
// This repository implements all persistence operations for the Credential entity:
//   - Queries include ZOMBIE SHIELD: isNull(deletedAt) on ALL reads
//   - Writes use soft deletes (set deletedAt timestamp, never hard delete)
//   - softDeleteAllByPrincipal applies Zombie Shield to avoid re-stamping
//     records that are already soft-deleted
//   - Uses Drizzle query builders and operators (eq, and, isNull)
//
// Factory pattern for dependency injection:
//   const repository = makeCredentialRepository(db);
//   await repository.findById('credential-id');
// =============================================================================

import { eq, and, isNull } from 'drizzle-orm';
import { credentials } from '../../schema/credentials';
import { Credential, CredentialType } from '../../domain/credential';
import { ICredentialRepository } from '../../domain/credentialRepository';
import { AuthDatabase } from '../database';

/**
 * Factory function that creates a Credential repository instance.
 *
 * @param db - Drizzle database instance with Auth schema
 * @returns ICredentialRepository implementation
 */
export const makeCredentialRepository = (db: AuthDatabase): ICredentialRepository => ({
  /**
   * Find a credential by its unique ID.
   * ZOMBIE SHIELD: Filters out soft-deleted credentials.
   */
  async findById(id: string): Promise<Credential | null> {
    const result = await db
      .select()
      .from(credentials)
      .where(and(eq(credentials.id, id), isNull(credentials.deletedAt)))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return mapToCredential(result[0]);
  },

  /**
   * Find all active credentials for a Principal of a specific type.
   * ZOMBIE SHIELD: Filters out soft-deleted credentials.
   */
  async findByPrincipalAndType(principalId: string, type: CredentialType): Promise<Credential[]> {
    const results = await db
      .select()
      .from(credentials)
      .where(
        and(
          eq(credentials.principalId, principalId),
          eq(credentials.type, type),
          isNull(credentials.deletedAt),
        ),
      );

    return results.map(mapToCredential);
  },

  /**
   * Find an active credential by OAuth provider and provider account ID.
   * Scoped to type='oauth' to prevent accidental cross-type matches.
   * ZOMBIE SHIELD: Filters out soft-deleted credentials.
   */
  async findByProviderAccount(provider: string, providerAccountId: string): Promise<Credential | null> {
    const result = await db
      .select()
      .from(credentials)
      .where(
        and(
          eq(credentials.provider, provider),
          eq(credentials.providerAccountId, providerAccountId),
          eq(credentials.type, 'oauth'),
          isNull(credentials.deletedAt),
        ),
      )
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return mapToCredential(result[0]);
  },

  /**
   * Find all active credentials matching a given API key prefix.
   * Used for O(1) bucket lookup before full hash verification.
   * ZOMBIE SHIELD: Filters out soft-deleted credentials.
   */
  async findByKeyPrefix(keyPrefix: string): Promise<Credential[]> {
    const results = await db
      .select()
      .from(credentials)
      .where(and(eq(credentials.keyPrefix, keyPrefix), isNull(credentials.deletedAt)));

    return results.map(mapToCredential);
  },

  /**
   * Find all active credentials belonging to a Principal.
   * ZOMBIE SHIELD: Filters out soft-deleted credentials.
   */
  async findAllByPrincipal(principalId: string): Promise<Credential[]> {
    const results = await db
      .select()
      .from(credentials)
      .where(and(eq(credentials.principalId, principalId), isNull(credentials.deletedAt)));

    return results.map(mapToCredential);
  },

  /**
   * Check whether a Principal has at least one active credential.
   * Optionally filtered by credential type.
   * ZOMBIE SHIELD: Filters out soft-deleted credentials.
   */
  async hasActiveCredential(principalId: string, type?: CredentialType): Promise<boolean> {
    const conditions = [eq(credentials.principalId, principalId), isNull(credentials.deletedAt)];

    if (type !== undefined) {
      conditions.push(eq(credentials.type, type));
    }

    const result = await db
      .select()
      .from(credentials)
      .where(and(...conditions))
      .limit(1);

    return result.length > 0;
  },

  /**
   * Persist a new credential to storage.
   * Converts undefined domain values to null for database compatibility.
   */
  async save(credential: Credential): Promise<void> {
    await db.insert(credentials).values({
      id: credential.id,
      principalId: credential.principalId,
      type: credential.type,
      provider: credential.provider ?? null,
      providerAccountId: credential.providerAccountId ?? null,
      secretHash: credential.secretHash,
      keyPrefix: credential.keyPrefix ?? null,
      lastUsedAt: credential.lastUsedAt ?? null,
      expiresAt: credential.expiresAt ?? null,
      deletedAt: credential.deletedAt ?? null,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
    });
  },

  /**
   * Update the lastUsedAt timestamp for a credential.
   * Used after successful authentication to track usage.
   */
  async updateLastUsedAt(id: string): Promise<void> {
    await db
      .update(credentials)
      .set({ lastUsedAt: new Date() })
      .where(eq(credentials.id, id));
  },

  /**
   * Soft-delete a single credential by ID.
   * NEVER hard-deletes — preserves audit trail.
   */
  async softDelete(id: string): Promise<void> {
    await db
      .update(credentials)
      .set({ deletedAt: new Date() })
      .where(eq(credentials.id, id));
  },

  /**
   * Soft-delete ALL active credentials for a Principal.
   * ZOMBIE SHIELD applied on write: only stamps records where deletedAt IS NULL
   * to avoid overwriting existing soft-delete timestamps on already-deleted records.
   */
  async softDeleteAllByPrincipal(principalId: string): Promise<void> {
    await db
      .update(credentials)
      .set({ deletedAt: new Date() })
      .where(and(eq(credentials.principalId, principalId), isNull(credentials.deletedAt)));
  },
});

// =============================================================================
// Internal Mapping Functions
// =============================================================================

/**
 * Maps a Drizzle query result row to the domain Credential type.
 *
 * Handles type conversions:
 *   - type (enum) → cast to CredentialType domain type
 *   - provider (text | null) → convert null to undefined
 *   - providerAccountId (text | null) → convert null to undefined
 *   - keyPrefix (text | null) → convert null to undefined
 *   - lastUsedAt (timestamp | null) → convert null to undefined
 *   - expiresAt (timestamp | null) → convert null to undefined
 *   - deletedAt (timestamp | null) → convert null to undefined
 */
function mapToCredential(row: typeof credentials.$inferSelect): Credential {
  return {
    id: row.id,
    principalId: row.principalId,
    type: row.type as CredentialType,
    provider: row.provider ?? undefined,
    providerAccountId: row.providerAccountId ?? undefined,
    secretHash: row.secretHash,
    keyPrefix: row.keyPrefix ?? undefined,
    lastUsedAt: row.lastUsedAt ?? undefined,
    expiresAt: row.expiresAt ?? undefined,
    deletedAt: row.deletedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
