// =============================================================================
// IAM Module — Database Type Definition
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
//   import * as iamSchema from '@/packages/@core/iam/schema';
//
//   const db = drizzle(pool, { schema: iamSchema });
//   // db now matches IAMDatabase type
// =============================================================================

import { drizzle } from 'drizzle-orm/node-postgres';
import * as iamSchema from '../schema';

/**
 * The type of the Drizzle database instance this module requires.
 *
 * Consuming applications must create a `drizzle()` instance with the IAM schema
 * and pass it to repository factories (makePolicyRepository, makeEntitlementRepository).
 *
 * This type enforces that the database instance includes:
 *   - All IAM schema tables (policies, entitlements)
 *   - All IAM schema relations (for relational queries)
 *   - TypeScript type safety for queries
 */
export type IAMDatabase = ReturnType<typeof drizzle<typeof iamSchema>>;
