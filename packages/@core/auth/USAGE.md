# Usage — @core/auth

## Setup

Wire repositories and services in your composition root:

```ts
import {
  makeCredentialRepository,
  makeHashingService,
  makeCreatePasswordCredentialUseCase,
  makeVerifyPasswordUseCase,
  makeCreateApiKeyUseCase,
  makeVerifyApiKeyUseCase,
} from '@core/auth'

const credentialRepo = makeCredentialRepository(db)
const hashingService = makeHashingService()

const createPassword = makeCreatePasswordCredentialUseCase(credentialRepo, hashingService)
const verifyPassword = makeVerifyPasswordUseCase(credentialRepo, hashingService)
const createApiKey = makeCreateApiKeyUseCase(credentialRepo, hashingService)
const verifyApiKey = makeVerifyApiKeyUseCase(credentialRepo, hashingService)
```

## I need to add password-based login

> In Nucleus, passwords are a type of **Credential**. The same system handles passwords, OAuth, and API keys — all stored and verified through the same credential repository.

```ts
// Requires: a Principal must already exist (identity:principal:exists)
const created = await createPassword({
  principalId: principal.id,  // the Principal this credential belongs to
  password: 'StrongP@ssw0rd!',
})

if (!created.success) {
  // 'CREDENTIAL_EXISTS' | 'PASSWORD_TOO_WEAK' | 'VALIDATION_ERROR'
  throw new Error(created.error.message)
}

// Verify during login
const verified = await verifyPassword({
  principalId: principal.id,
  password: 'StrongP@ssw0rd!',
})

if (verified.success) {
  // verified.value.principalId — proceed to session creation
}
```

## I need to add API key authentication

> API keys are **Credentials** with a prefix-based O(1) lookup. The raw key is returned once on creation and cannot be recovered.

```ts
const keyResult = await createApiKey({
  principalId: principal.id,  // the Principal this API key belongs to
  expiresAt: new Date('2027-01-01'),  // optional
})

if (keyResult.success) {
  // Return keyResult.value.rawKey to the caller EXACTLY ONCE — it cannot be recovered
  // Format: nk_{8chars}_{rest}
  // Store keyResult.value.credential.keyPrefix for O(1) lookup during verification
  const { rawKey, credential } = keyResult.value
}

// Verify an incoming API key (e.g. from Authorization header)
const verifyResult = await verifyApiKey({ rawKey: 'nk_a1b2c3d4_...' })

if (verifyResult.success) {
  // verifyResult.value.principalId — the authenticated principal
}
```
