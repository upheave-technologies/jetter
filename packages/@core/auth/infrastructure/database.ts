// =============================================================================
// Auth Module — Database Type Definition
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
//   import * as authSchema from '@/packages/@core/auth/schema';
//
//   const db = drizzle(pool, { schema: authSchema });
//   // db now matches AuthDatabase type
// =============================================================================

import { drizzle } from 'drizzle-orm/node-postgres';
import * as authSchema from '../schema';

/**
 * The type of the Drizzle database instance this module requires.
 *
 * Consuming applications must create a `drizzle()` instance with the Auth schema
 * and pass it to repository factories (makeCredentialRepository).
 *
 * This type enforces that the database instance includes:
 *   - All Auth schema tables (credentials)
 *   - All Auth schema relations (for relational queries)
 *   - TypeScript type safety for queries
 */
export type AuthDatabase = ReturnType<typeof drizzle<typeof authSchema>>;
