// =============================================================================
// IAM Module — Public API (Barrel Export)
// =============================================================================
// This is the single entry point for consuming applications to import from
// the IAM module. It exports only the public API, hiding internal implementation
// details.
//
// Usage in consuming application:
//   import {
//     IAMDatabase,
//     makePolicyRepository,
//     makeGrantEntitlementUseCase,
//     type Policy,
//     type AppAbility
//   } from '@/packages/@core/iam';
// =============================================================================

// -----------------------------------------------------------------------------
// Schema (for consuming apps to compose their database)
// -----------------------------------------------------------------------------
export * from './schema';

// -----------------------------------------------------------------------------
// Database Type (for typing the db instance)
// -----------------------------------------------------------------------------
export type { IAMDatabase } from './infrastructure/database';

// -----------------------------------------------------------------------------
// Repository Factories (for creating repository instances)
// -----------------------------------------------------------------------------
export { makePolicyRepository } from './infrastructure/repositories/DrizzlePolicyRepository';
export { makeEntitlementRepository } from './infrastructure/repositories/DrizzleEntitlementRepository';

// -----------------------------------------------------------------------------
// Use Case Factories (for creating use case instances)
// -----------------------------------------------------------------------------
export { makeCreatePolicyUseCase } from './application/createPolicyUseCase';
export { makeUpdatePolicyActionsUseCase } from './application/updatePolicyActionsUseCase';
export { makeGrantEntitlementUseCase } from './application/grantEntitlementUseCase';
export { makeRevokeEntitlementUseCase } from './application/revokeEntitlementUseCase';
export { makeResolvePrincipalPermissionsUseCase } from './application/resolvePrincipalPermissionsUseCase';
export { makeEvaluateAccessUseCase } from './application/evaluateAccessUseCase';
export { makeBuildPrincipalAbilityUseCase } from './application/buildPrincipalAbilityUseCase';

// -----------------------------------------------------------------------------
// CASL Types (for consuming apps that use the ability object)
// -----------------------------------------------------------------------------
export type { AppAbility } from './infrastructure/CASLAbilityFactory';

// -----------------------------------------------------------------------------
// Domain Types (for consuming apps to use in their type signatures)
// -----------------------------------------------------------------------------
export type { Policy, PolicyScope } from './domain/policy';
export type { Entitlement } from './domain/entitlement';
export type { ActionParts } from './domain/action';

// -----------------------------------------------------------------------------
// Error Types (for consuming apps to handle errors)
// -----------------------------------------------------------------------------
export { AccessError } from './application/accessError';
