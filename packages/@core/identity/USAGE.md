# Usage — @core/identity

## Setup

Wire the repository in your composition root:

```ts
import {
  makePrincipalRepository,
  makeCreatePrincipalUseCase,
  makeSuspendPrincipalUseCase,
  makeReactivatePrincipalUseCase,
} from '@core/identity'

const principalRepo = makePrincipalRepository(db)
const createPrincipal = makeCreatePrincipalUseCase(principalRepo)
const suspendPrincipal = makeSuspendPrincipalUseCase(principalRepo)
const reactivatePrincipal = makeReactivatePrincipalUseCase(principalRepo)
```

## I need to create a user account

> In Nucleus, users are called **Principals**. A Principal can be a human, an AI agent, or a system worker — they're all treated identically.

```ts
const result = await createPrincipal({
  type: 'human',          // principal type: 'human' | 'agent' | 'system'
  name: 'Ada Lovelace',
  email: 'ada@example.com',
})

if (result.success) {
  console.log(result.value.id)      // cuid2 string
  console.log(result.value.status)  // 'active'
} else {
  console.error(result.error.code)
  // 'EMAIL_ALREADY_EXISTS' | 'VALIDATION_ERROR' | 'SERVICE_ERROR'
}
```

## I need to disable or re-enable a user account

> Nucleus uses **suspend** (temporary) and **deactivate** (permanent) instead of "disable". Suspended Principals can be reactivated; deactivated ones cannot.

```ts
// active → suspended (e.g. account abuse, pending review)
const suspended = await suspendPrincipal({ id: principal.id })

if (!suspended.success) {
  // 'PRINCIPAL_NOT_FOUND' | 'PRINCIPAL_ALREADY_DEACTIVATED' | 'INVALID_STATUS_TRANSITION'
  throw new Error(suspended.error.message)
}

// suspended → active (e.g. review resolved, account reinstated)
const reactivated = await reactivatePrincipal({ id: principal.id })
```

## I need to permanently delete a user account

> Nucleus uses **soft delete** — deactivation marks the record as deleted but preserves it for audit trails. The operation is irreversible; the Principal cannot be reactivated after this.

```ts
import { makeDeactivatePrincipalUseCase } from '@core/identity'

const deactivatePrincipal = makeDeactivatePrincipalUseCase(principalRepo)

// Soft-deletes the Principal — irreversible
await deactivatePrincipal({ id: principal.id })
```
