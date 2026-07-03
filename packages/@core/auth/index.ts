// =============================================================================
// Auth Module — Public API (Barrel Export)
// =============================================================================
// This is the single entry point for consuming applications to import from
// the Auth module. It exports only the public API, hiding internal implementation
// details such as HashingService type, ICredentialRepository, mapToCredential,
// validation functions, and Argon2 configuration.
//
// Usage in consuming application:
//   import {
//     AuthDatabase,
//     makeCredentialRepository,
//     makeHashingService,
//     makeCreatePasswordCredentialUseCase,
//     makeVerifyPasswordUseCase,
//     type Credential,
//     type CredentialType,
//     AuthError,
//   } from '@/packages/@core/auth';
// =============================================================================

// -----------------------------------------------------------------------------
// Schema (for consuming apps to compose their database)
// -----------------------------------------------------------------------------
export * from './schema';

// -----------------------------------------------------------------------------
// Database Type (for typing the db instance)
// -----------------------------------------------------------------------------
export type { AuthDatabase } from './infrastructure/database';

// -----------------------------------------------------------------------------
// Repository Factory (for creating repository instances)
// -----------------------------------------------------------------------------
export { makeCredentialRepository } from './infrastructure/repositories/DrizzleCredentialRepository';

// -----------------------------------------------------------------------------
// Hashing Service Factory (for creating the hashing service instance)
// -----------------------------------------------------------------------------
export { makeHashingService } from './infrastructure/hashingService';

// -----------------------------------------------------------------------------
// Use Case Factories (for creating use case instances)
// -----------------------------------------------------------------------------
export { makeCreatePasswordCredentialUseCase } from './application/createPasswordCredentialUseCase';
export { makeVerifyPasswordUseCase } from './application/verifyPasswordUseCase';
export { makeChangePasswordUseCase } from './application/changePasswordUseCase';
export { makeLinkOAuthProviderUseCase } from './application/linkOAuthProviderUseCase';
export { makeVerifyOAuthProviderUseCase } from './application/verifyOAuthProviderUseCase';
export { makeCreateApiKeyUseCase } from './application/createApiKeyUseCase';
export { makeVerifyApiKeyUseCase } from './application/verifyApiKeyUseCase';
export { makeRevokeCredentialUseCase } from './application/revokeCredentialUseCase';
export { makeRevokeAllCredentialsUseCase } from './application/revokeAllCredentialsUseCase';
export { makeHasActiveCredentialUseCase } from './application/hasActiveCredentialUseCase';

// -----------------------------------------------------------------------------
// Domain Types (for consuming apps to use in their type signatures)
// -----------------------------------------------------------------------------
export type { Credential, CredentialType } from './domain/credential';

// -----------------------------------------------------------------------------
// Error Types (for consuming apps to handle errors)
// -----------------------------------------------------------------------------
export { AuthError } from './application/authError';
