// =============================================================================
// Auth Module — Hashing Service
// =============================================================================
// Provides password / secret hashing and verification using Argon2id via
// the `@node-rs/argon2` native binding.
//
// Argon2id is the recommended variant for password hashing (OWASP 2023):
//   - memoryCost: 19456 KiB (19 MiB) — resists GPU-based attacks
//   - timeCost:   2 iterations        — balances security and latency
//   - parallelism: 1 lane             — single-threaded for server safety
//   - outputLen:  32 bytes            — 256-bit hash output
//
// Design decisions:
//   - HashingService is a plain object type (not a class) per DDD functional style
//   - makeHashingService() is a factory that returns a HashingService instance
//   - HashingService type is intentionally NOT exported from this file's barrel;
//     only makeHashingService is exported. Consumers depend on the factory, not
//     the type, to allow future algorithm substitution without API changes.
// =============================================================================

import { hash, verify } from '@node-rs/argon2';

// =============================================================================
// SECTION 1: TYPE
// =============================================================================

type HashingService = {
  /**
   * Hashes a plain-text secret using Argon2id.
   * Returns the encoded hash string (includes algorithm params and salt).
   */
  hash: (plain: string) => Promise<string>;

  /**
   * Verifies a plain-text secret against a stored Argon2id hash.
   * Returns true if the secret matches, false otherwise.
   */
  verify: (plain: string, hashed: string) => Promise<boolean>;
};

// =============================================================================
// SECTION 2: FACTORY
// =============================================================================

/**
 * Creates a HashingService backed by Argon2id.
 *
 * Usage:
 *   const hashingService = makeHashingService();
 *   const hashed = await hashingService.hash('MyP@ssw0rd!');
 *   const valid  = await hashingService.verify('MyP@ssw0rd!', hashed);
 */
export const makeHashingService = (): HashingService => {
  const argon2Options = {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
    outputLen: 32,
  } as const;

  return {
    hash: (plain: string): Promise<string> => {
      return hash(plain, argon2Options);
    },

    verify: (plain: string, hashed: string): Promise<boolean> => {
      return verify(hashed, plain);
    },
  };
};
