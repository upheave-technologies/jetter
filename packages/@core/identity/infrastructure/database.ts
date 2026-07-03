// =============================================================================
// Identity Module — Database Type Definition
// =============================================================================
// Defines the type of the Drizzle database instance this module requires.
//
// The consuming application creates the actual database instance using
// `drizzle()` with this module's schema and passes it to repository factories.
//
// This module does NOT create database connections — it only defines the type
// contract for dependency injection.
//
// Usage in consuming application:
//   import { drizzle } from 'drizzle-orm/node-postgres';
//   import * as identitySchema from '@/packages/@core/identity/schema';
//
//   const db = drizzle(pool, { schema: identitySchema });
//   // db now matches IdentityDatabase type
// =============================================================================

import { drizzle } from 'drizzle-orm/node-postgres';
import * as identitySchema from '../schema';

/**
 * The type of the Drizzle database instance this module requires.
 *
 * Consuming applications must create a `drizzle()` instance with the Identity schema
 * and pass it to repository factories (makePrincipalRepository).
 *
 * This type enforces that the database instance includes:
 *   - All Identity schema tables (identity_principals)
 *   - All Identity schema relations (for relational queries)
 *   - TypeScript type safety for queries
 */
export type IdentityDatabase = ReturnType<typeof drizzle<typeof identitySchema>>;
