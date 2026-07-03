---
name: prover
description: "How to operate the Nucleus scenario prover: run checks, interpret verdicts, write scenarios, add capability annotations, and register new effect tokens."
---

# Prover — Scenario Verification Engine

The prover answers: "Given the capabilities declared across all modules, can a desired cross-module workflow be achieved?" It uses forward-chaining: starting from an initial state, it iteratively fires eligible capabilities until all desired outcome effects are satisfied or progress stalls. Result is always PASS or FAIL.

Three concepts underpin the system:

1. **Capability annotations** — every use case file has a co-located `*UseCase.capability.ts` sidecar that exports a `capability` constant declaring what must already be true (preconditions) and what becomes true (effects) after the use case succeeds. The use case file itself has zero prover imports.
2. **Manifests** — `capabilities.yml` files, one per module. Usually auto-generated from annotations via the generator. Can also be hand-written for packages that don't have code yet (see Capability-First Design below).
3. **Scenarios** — YAML files in `system/scenarios/` describing a desired cross-module workflow (initial state + desired outcome). These you write by hand.

---

## Commands

All commands are run from the repo root.

```bash
# Regenerate capabilities.yml from annotations in all use case files
npm run scenarios:generate

# Prove all scenarios
npm run scenarios:check

# Prove one scenario by exact name
npm run scenarios:check -- --scenario "Nucleus registration"

# JSON output (useful for scripting or piping)
npm run scenarios:check -- --json

# Validate manifests and scenarios only (no proving)
npm run scenarios:check -- --validate

# Execute passing proof chains against real PostgreSQL
npm run scenarios:run

# Execute one scenario against the database
npm run scenarios:run -- --scenario "Nucleus registration"
```

**When to use each:**
- After adding or changing a use case → `scenarios:generate` then `scenarios:check`
- After writing a new scenario → `scenarios:check -- --scenario "Name"` first
- To confirm all existing scenarios still pass → `scenarios:check`
- To validate YAML is well-formed → `scenarios:check -- --validate`
- To run a proof chain end-to-end against Postgres → `scenarios:run`

---

## Interpreting Output

### PASS verdict

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCENARIO: Nucleus registration
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PASS

Proof Chain:
  1. [identity] create-principal → identity:principal:exists
  2. [auth] create-password-credential (credential_type: password) → auth:credential:exists
  3. [iam] create-policy → iam:policy:exists
  4. [iam] grant-entitlement → iam:entitlement:granted

Recipe:
  Step 1: Call makeCreatePrincipalUseCase from identity module
  Step 2: Call makeCreatePasswordCredentialUseCase from auth module (credential_type=password)
  Step 3: Call makeCreatePolicyUseCase from iam module
  Step 4: Call makeGrantEntitlementUseCase from iam module
```

- **Proof Chain** — the ordered list of capabilities the engine applied. Each step shows module, capability name, optional context, and the primary effect it contributes.
- **Recipe** — the same steps expressed as human-readable orchestration instructions naming the exact use case factory.

### FAIL verdict

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCENARIO: Billing subscription setup
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FAIL

Gaps:
  x billing:subscription:active — No capability produces this effect

Partial Progress:
  + identity:principal:exists (via [identity] create-principal)
```

- **Gaps** — every outcome effect that could not be satisfied, with a reason:
  - `No capability produces this effect` — the effect token does not appear in any manifest. The module that owns this capability doesn't exist yet, or the annotation is missing.
  - `No capability produces this effect with context matching where(credential_type="api_key")` — capabilities exist but none match the where-clause.
  - `Capability preconditions could not be met` — a capability that produces the effect exists, but its preconditions could never be satisfied from the initial state.
- **Partial Progress** — outcome effects that were satisfied before the engine stalled. Useful for diagnosing which part of the chain is broken.

---

## Writing Scenarios

Create a YAML file in `system/scenarios/`. File name should be kebab-case matching the scenario topic.

### Minimal scenario

```yaml
name: Nucleus API key verification
description: |
  A bot agent authenticates programmatically via API key.

initial_state:
  - identity:principal:exists
  - auth:credential:exists

outcome:
  - auth:credential:verified
```

- `name` — unique across all scenarios. Used with `--scenario` flag.
- `description` — plain-language narrative. Explain why the scenario matters.
- `initial_state` — effect tokens that are given as true at the start. Use an empty list `[]` if nothing is assumed.
- `outcome` — effect tokens that must all be true for the scenario to PASS.

### Outcome with where-clause

Use a where-clause when multiple capabilities produce the same effect but only one variant is acceptable:

```yaml
outcome:
  - auth:credential:verified
  - effect: auth:credential:exists
    where:
      credential_type: api_key
```

The where-clause is a key-value map that must match the `context` on the capability card. All keys in the where-clause must match; extra context keys on the capability are ignored.

### Ordering constraint

Use ordering when the scenario requires a specific sequencing between two outcome effects:

```yaml
outcome:
  - tenancy:membership:exists
  - iam:entitlement:granted

ordering:
  - tenancy:membership:exists -> iam:entitlement:granted
```

The engine will attempt topological reordering of the proof chain to satisfy ordering. If a cycle would result, the scenario FAILs.

---

## Adding Capability Annotations to Use Cases

Capability annotations live in **sidecar files** — `*UseCase.capability.ts` — co-located with the use case file. The use case file itself has zero prover imports. The generator scans `.capability.ts` files, not the use case files directly.

Every file matching `packages/@core/*/application/*UseCase.ts` or `modules/*/application/*UseCase.ts` **must** have a corresponding `*UseCase.capability.ts` sidecar. The generator errors out if any use case file is missing its sidecar.

### Standard single annotation

```typescript
// In evaluateAccessUseCase.capability.ts (sidecar file — not in the use case file)
import { defineCapability } from '@/packages/shared/lib/capability';
import { CAPABILITIES } from '@/packages/shared/prover/capabilities';
import { EFFECTS } from '@/packages/shared/prover/effects';

export const capability = defineCapability({
  name: CAPABILITIES.iam.evaluateAccess,
  useCase: 'makeEvaluateAccessUseCase',
  preconditions: [EFFECTS.identity.principal.exists],
  effects: [EFFECTS.iam.access.evaluated],
});
```

- `name` — capability identifier from `CAPABILITIES`. Must be unique within the module.
- `useCase` — the factory function name (string, informational only — never imported by the prover).
- `preconditions` — effect tokens from `EFFECTS` that must be in state before this capability can fire. Use `[]` if none required.
- `effects` — effect tokens added to state when this capability succeeds. At least one required.

The use case file (`evaluateAccessUseCase.ts`) imports nothing from `@/packages/shared/prover/` or `@/packages/shared/lib/capability`. All prover vocabulary is confined to the sidecar.

### With optional description

Add a short `description` when the business rules are not obvious from the capability name + effect tokens alone. Keep it succinct — one sentence max.

```typescript
// In verifyPasswordUseCase.capability.ts (sidecar file)
import { defineCapability } from '@/packages/shared/lib/capability';
import { CAPABILITIES } from '@/packages/shared/prover/capabilities';
import { EFFECTS } from '@/packages/shared/prover/effects';
import { CONTEXTS } from '@/packages/shared/prover/contexts';

export const capability = defineCapability({
  name: CAPABILITIES.auth.verifyPassword,
  description: 'Verifies a password credential matches the stored hash',
  useCase: 'makeVerifyPasswordUseCase',
  preconditions: [EFFECTS.auth.credential.exists],
  effects: [EFFECTS.auth.credential.verified],
  context: CONTEXTS.credentialType.password,
});
```

The description is optional — skip it when the name and tokens are self-explanatory. It flows through to `capabilities.yml` and is available to the `/capabilities` conversational explorer.

### With context (for where-clause matching)

```typescript
// In createApiKeyUseCase.capability.ts (sidecar file)
import { defineCapability } from '@/packages/shared/lib/capability';
import { CAPABILITIES } from '@/packages/shared/prover/capabilities';
import { EFFECTS } from '@/packages/shared/prover/effects';
import { CONTEXTS } from '@/packages/shared/prover/contexts';

export const capability = defineCapability({
  name: CAPABILITIES.auth.createApiKey,
  useCase: 'makeCreateApiKeyUseCase',
  preconditions: [EFFECTS.identity.principal.exists],
  effects: [EFFECTS.auth.credential.exists],
  context: CONTEXTS.credentialType.apiKey,  // { credential_type: 'api_key' }
});
```

Context allows scenarios to use where-clauses to select a specific variant of a capability.

### Query capabilities (skipped by generator)

Use cases that are pure reads with no state change should be marked `query: true`. The generator will skip them — they do not appear in `capabilities.yml`.

```typescript
// In getPrincipalUseCase.capability.ts (sidecar file)
import { defineCapability } from '@/packages/shared/lib/capability';
import { CAPABILITIES } from '@/packages/shared/prover/capabilities';

export const capability = defineCapability({
  name: CAPABILITIES.identity.getPrincipal,
  useCase: 'makeGetPrincipalUseCase',
  preconditions: [],
  effects: [],
  query: true,
});
```

### Multiple capabilities from one file (rare)

If a single use case file genuinely produces more than one capability, export an array from the sidecar:

```typescript
// In someUseCase.capability.ts (sidecar file)
export const capabilities = [
  defineCapability({ name: '...', useCase: '...', preconditions: [], effects: [...] }),
  defineCapability({ name: '...', useCase: '...', preconditions: [], effects: [...] }),
];
```

---

## Effect Token Naming and Registration

### Format

```
{domain}:{entity}:{predicate}
```

All lowercase, hyphen-separated words within each segment.

Examples:
- `identity:principal:exists`
- `auth:credential:verified`
- `iam:entitlement:granted`
- `tenancy:membership:exists`

### Registering a new effect token

1. Open `/Users/mario/code/Labs/nucleus/packages/shared/prover/effects.ts`
2. Add the token under the appropriate domain and entity. If the domain or entity does not exist, add it:

```typescript
export const EFFECTS = {
  // ...existing...
  tenancy: {
    membership: {
      exists: 'tenancy:membership:exists',
      revoked: 'tenancy:membership:revoked',
    },
  },
} as const;
```

3. Use `EFFECTS.tenancy.membership.exists` in annotations and scenarios instead of the raw string. This makes cross-file connections compiler-verified and grep-able.

### Registering a new capability name

Open `/Users/mario/code/Labs/nucleus/packages/shared/prover/capabilities.ts` and add under the appropriate module:

```typescript
export const CAPABILITIES = {
  // ...existing...
  tenancy: {
    addMember: 'add-member',
    removeMember: 'remove-member',
  },
} as const;
```

### Registering a new context constant

Open `/Users/mario/code/Labs/nucleus/packages/shared/prover/contexts.ts` and add a new entry:

```typescript
export const CONTEXTS = {
  credentialType: { ... },  // existing
  memberRole: {
    key: 'member_role',
    admin: { member_role: 'admin' } as const,
    viewer: { member_role: 'viewer' } as const,
  },
} as const;
```

---

## Compositional Impact Guard (MANDATORY)

**After ANY change to capabilities — adding, removing, or modifying capability annotations, effect tokens, or manifests — you MUST re-prove all scenarios and report the result.**

```
npm run scenarios:check
```

This is non-negotiable. A capability change that silently breaks an existing scenario is an architectural regression. The guard applies whether the change was:
- A new capability added to an existing or new package
- A capability removed or its preconditions/effects changed
- Effect tokens added, renamed, or removed from `effects.ts`
- A hand-written `capabilities.yml` added for a proposed package
- The generator re-run after use case code changes

**If any scenario FAILs after the change:**
1. Report the failing scenario name and gaps to the user
2. Do NOT proceed with further work until the user decides whether to fix the gap, update the scenario, or accept the regression
3. Never silently ignore a broken scenario

**If all scenarios PASS:** Report the summary (X scenarios, all passing) and proceed.

---

## Generator Workflow

The standard cycle when adding or modifying use cases:

```
1. Create/update the sidecar file: {verb}{Entity}UseCase.capability.ts
2. Register any new EFFECTS, CAPABILITIES, or CONTEXTS tokens in shared/prover/
3. npm run scenarios:generate     ← writes capabilities.yml
4. npm run scenarios:check        ← verify all scenarios still pass (MANDATORY — see Compositional Impact Guard)
```

The generator:
- Discovers all `*UseCase.ts` files in `packages/@core/*/application/` and `modules/*/application/`
- For each discovered use case, reads the co-located `*UseCase.capability.ts` sidecar file
- Dynamically imports each sidecar and reads its `capability` or `capabilities` export
- Skips capabilities with `query: true`
- Sorts capabilities alphabetically within each module
- Writes `capabilities.yml` to the module root (e.g., `packages/@core/iam/capabilities.yml`)
- Emits drift warnings to stderr if a use case's code hash changed since last generation (the annotation may need updating)

**The generator errors out** if any use case file is missing its sidecar. Fix all missing sidecars before the generate command will succeed.

---

## Capability-First Design (Hand-Written Manifests)

When designing a new core package, you can write a `capabilities.yml` by hand before any code exists. The prover discovers manifests by glob pattern — any `capabilities.yml` placed in a package directory is automatically included.

**Workflow:**

```
1. Create the package directory: packages/@core/{name}/
2. Write capabilities.yml by hand — declare capabilities, preconditions, effects
3. npm run scenarios:check        ← proves composition with existing capabilities
4. Write scenarios in system/scenarios/ exercising the new package
5. npm run scenarios:check        ← proves the new scenarios pass
6. Iterate on the manifest until surface area is minimal and scenarios pass
7. Implement — code fulfills the already-proven capability spec
8. npm run scenarios:generate     ← replaces hand-written manifest with generated one
```

The hand-written manifest uses the same format as generated ones but without hash comments:

```yaml
module: {name}
capabilities:
  - name: {capability-name}
    use_case: {makeVerbEntityUseCase}
    description: "Short business-rules description"
    preconditions:
      - "{domain}:{entity}:{predicate}"
    effects:
      - "{domain}:{entity}:{predicate}"
```

New effect tokens and capability constants should be registered in `shared/prover/effects.ts` and `shared/prover/capabilities.ts` before the manifest references them — the parser validates token format but the prover needs the tokens to exist for composition to work.

---

## Key File Locations

| Purpose | Path |
|---|---|
| Prover engine (pure computation) | `packages/prover/engine.ts` |
| CLI entry point | `packages/prover/cli.ts` |
| Scenario runner (executes against Postgres) | `packages/prover/run.ts` |
| Manifest/scenario generator | `packages/prover/generate.ts` |
| Type definitions | `packages/prover/types.ts` |
| Effect token constants | `packages/shared/prover/effects.ts` |
| Capability name constants | `packages/shared/prover/capabilities.ts` |
| Context constants | `packages/shared/prover/contexts.ts` |
| defineCapability helper | `packages/shared/lib/capability.ts` |
| Scenarios directory | `system/scenarios/` |
| Core module manifests | `packages/@core/*/capabilities.yml` |
| Application module manifests | `modules/*/capabilities.yml` |

---

## Troubleshooting

### Gap: "No capability produces this effect"

The effect token does not appear in any `capabilities.yml`. Causes:
- The module that owns the capability has not been implemented yet (expected — document with a description note in the scenario).
- The annotation is present but `npm run scenarios:generate` has not been run since it was added. Run the generator.
- The effect token string in the scenario does not match the string in the annotation. Check spelling and format.

### Gap: "Capability preconditions could not be met"

A capability that produces the required effect exists, but the engine could not satisfy its preconditions from the initial state. Causes:
- The scenario's `initial_state` is missing an effect that should be given as a precondition. Add it.
- A chain of capabilities is needed to reach the precondition, but one link in the chain is itself gapped. Check partial progress output to see where the chain broke.
- The precondition effect token in the annotation differs from what other capabilities produce. Cross-check `EFFECTS` constants.

### Gap: "No capability produces this effect with context matching where(...)"

Capabilities produce the effect, but none have a matching `context`. Causes:
- The where-clause value does not match any `CONTEXTS` constant. Check `contexts.ts`.
- The capability annotation is missing a `context` field. Add it using `CONTEXTS`.

### Generator drift warning

```
WARNING: create-api-key (auth) — use case code changed since last generation. Verify capability annotation is still accurate.
```

The use case file's code changed since the last `capabilities.yml` was written. Review the annotation to confirm preconditions and effects still accurately reflect what the use case does. Then re-run `scenarios:generate` to clear the warning.

### Generator fails: missing sidecar

```
ERROR: The following use case files are missing a capability sidecar:
  packages/@core/auth/application/someNewUseCase.ts: missing sidecar 'someNewUseCase.capability.ts'
```

Every `*UseCase.ts` file must have a co-located `*UseCase.capability.ts` sidecar that exports a `capability` constant. Create the sidecar file (use `query: true` if it is a pure read with no state change).

### Ordering conflict

```
FAIL
Gaps:
  x tenancy:membership:exists -> iam:entitlement:granted — Ordering constraints conflict with precondition dependencies — cannot reorder proof chain
```

The requested ordering contradicts the precondition dependency graph (creating a cycle). The constraint `A -> B` cannot be satisfied if B's capability requires A as a precondition — that order is already forced by preconditions. Remove the redundant ordering constraint, or reconsider whether the ordering is genuinely necessary.
