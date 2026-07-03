// =============================================================================
// Identity Module — Public API (Barrel Export)
// =============================================================================
// This is the single entry point for consuming applications to import from
// the Identity module. It exports only the public API, hiding internal
// implementation details such as IPrincipalRepository, mapToPrincipal,
// validation functions, and cuid2 configuration.
//
// Usage in consuming application:
//   import {
//     type IdentityDatabase,
//     makePrincipalRepository,
//     makeCreatePrincipalUseCase,
//     makeGetPrincipalUseCase,
//     type Principal,
//     type PrincipalType,
//     type PrincipalStatus,
//     IdentityError,
//   } from '@core/identity';
// =============================================================================

// -----------------------------------------------------------------------------
// Schema (for consuming apps to compose their database)
// -----------------------------------------------------------------------------
export * from './schema';

// -----------------------------------------------------------------------------
// Database Type (for typing the db instance)
// -----------------------------------------------------------------------------
export type { IdentityDatabase } from './infrastructure/database';

// -----------------------------------------------------------------------------
// Repository Factory (for creating repository instances)
// -----------------------------------------------------------------------------
export { makePrincipalRepository } from './infrastructure/repositories/DrizzlePrincipalRepository';

// -----------------------------------------------------------------------------
// Use Case Factories (for creating use case instances)
// -----------------------------------------------------------------------------
export { makeCreatePrincipalUseCase } from './application/createPrincipalUseCase';
export { makeGetPrincipalUseCase } from './application/getPrincipalUseCase';
export { makeGetPrincipalByEmailUseCase } from './application/getPrincipalByEmailUseCase';
export { makeListPrincipalsUseCase } from './application/listPrincipalsUseCase';
export type { ListPrincipalsInput, ListPrincipalsOutput } from './application/listPrincipalsUseCase';
export { makeUpdatePrincipalUseCase } from './application/updatePrincipalUseCase';
export { makeSuspendPrincipalUseCase } from './application/suspendPrincipalUseCase';
export { makeReactivatePrincipalUseCase } from './application/reactivatePrincipalUseCase';
export { makeDeactivatePrincipalUseCase } from './application/deactivatePrincipalUseCase';

// -----------------------------------------------------------------------------
// Domain Types (for consuming apps to use in their type signatures)
// -----------------------------------------------------------------------------
export type { Principal, PrincipalType, PrincipalStatus } from './domain/principal';

// -----------------------------------------------------------------------------
// Error Types (for consuming apps to handle errors)
// -----------------------------------------------------------------------------
export { IdentityError } from './application/identityError';
