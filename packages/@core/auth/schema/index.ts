// =============================================================================
// Auth Module — Schema Barrel Export
// =============================================================================
// This is the public API of the Auth module's data model. Consuming applications
// import from here to compose their database schema.
//
// Usage in a consuming application's drizzle.config.ts:
//   schema: ['./packages/@core/auth/schema/index.ts']
//
// Usage in application code:
//   import { credentials, authCredentialType } from '@/packages/@core/auth/schema';
// =============================================================================

export { credentials } from './credentials';
export { authCredentialType } from './enums';
export { credentialsRelations } from './relations';
