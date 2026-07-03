# Usage — shared

## I need to handle success and failure from use cases

> Every Nucleus use case returns a **Result** — a discriminated union that's either `{ success: true, value: T }` or `{ success: false, error: E }`. No exceptions are thrown.

```ts
import type { Result } from '@/packages/shared/lib/result'

const result = await createPrincipal({ type: 'human', name: 'Ada', email: 'ada@example.com' })

if (!result.success) {
  // TypeScript knows result.error exists here
  console.error(result.error.message, result.error.code)
  return
}

// TypeScript knows result.value exists here
const principal = result.value
console.log(principal.id)
```

Pass Result through without re-wrapping when error types match:

```ts
const nameResult = validateName(data.name)
if (!nameResult.success) return nameResult   // pass-through — same error type

const validName = nameResult.value           // narrowed — safe to access .value
```

## I need to annotate a new use case for the capability system

> Every use case must have a `.capability.ts` sidecar that declares what **effects** it produces and what **preconditions** it requires. This powers the prover and auto-generated documentation.

```ts
// application/createFooUseCase.capability.ts
import { defineCapability } from '@/packages/shared/lib/capability'
import { CAPABILITIES } from '@/packages/shared/prover/capabilities'
import { EFFECTS } from '@/packages/shared/prover/effects'

export const capability = defineCapability({
  name: CAPABILITIES.myModule.createFoo,
  useCase: 'makeCreateFooUseCase',
  preconditions: [EFFECTS.identity.principal.exists],   // what must be true before running
  effects: [EFFECTS.myModule.foo.exists],               // what becomes true after success
})
```

For query-only use cases that read without changing state, add `query: true` and `effects: []`:

```ts
export const capability = defineCapability({
  name: CAPABILITIES.myModule.getFoo,
  useCase: 'makeGetFooUseCase',
  preconditions: [EFFECTS.myModule.foo.exists],
  effects: [],
  query: true,
})
```

When adding a new module, register constants in `packages/shared/prover/capabilities.ts` and `packages/shared/prover/effects.ts`, then run:

```sh
npx tsx packages/prover/generate.ts
```
