// =============================================================================
// IAM Module — Schema Barrel Export
// =============================================================================
// This is the public API of the IAM module's data model. Consuming applications
// import from here to compose their database schema.
//
// Usage in a consuming application's drizzle.config.ts:
//   schema: ['./packages/@core/iam/schema/index.ts']
//
// Usage in application code:
//   import { policies, entitlements, policyScope } from '@/packages/@core/iam/schema';
// =============================================================================

export { policies } from './policies';
export { entitlements } from './entitlements';
export { policyScope } from './enums';
export { policiesRelations, entitlementsRelations } from './relations';
