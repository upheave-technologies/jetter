// =============================================================================
// Identity Module — Schema Barrel Export
// =============================================================================
// This is the public API of the Identity module's data model. Consuming
// applications import from here to compose their database schema.
//
// Usage in a consuming application's drizzle.config.ts:
//   schema: ['./packages/@core/identity/schema/index.ts']
//
// Usage in application code:
//   import { identityPrincipals, identityPrincipalType } from '@/packages/@core/identity/schema';
// =============================================================================

export { identityPrincipals } from './principals';
export { identityPrincipalType, identityPrincipalStatus } from './enums';
export { identityPrincipalsRelations } from './relations';
