# Usage — @core/iam

## Setup

Wire repositories in your composition root:

```ts
import {
  makePolicyRepository,
  makeEntitlementRepository,
  makeCreatePolicyUseCase,
  makeGrantEntitlementUseCase,
  makeEvaluateAccessUseCase,
} from '@core/iam'

const policyRepo = makePolicyRepository(db)
const entitlementRepo = makeEntitlementRepository(db)

const createPolicy = makeCreatePolicyUseCase(policyRepo)

// grantEntitlement receives entitlementRepo first, then policyRepo
const grantEntitlement = makeGrantEntitlementUseCase(entitlementRepo, policyRepo)

// evaluateAccess only needs entitlementRepo — policy data is loaded via joined entitlements
const evaluateAccess = makeEvaluateAccessUseCase(entitlementRepo)
```

## I need to set up roles and permissions

> Nucleus uses **Policies** instead of roles — a Policy is a named bundle of allowed actions (like "campaign-editor: read, write, publish"). An **Entitlement** grants a Policy to a Principal within an organization (**Tenant**).

```ts
// Create a policy with allowed actions (format: "resource:action" or "resource:action:scope")
const policyResult = await createPolicy({
  name: 'campaign-editor',
  scope: 'TENANT',
  actions: ['campaigns:read', 'campaigns:update', 'campaigns:publish'],
})

if (!policyResult.success) {
  // 'POLICY_EXISTS' | 'VALIDATION_ERROR'
  throw new Error(policyResult.error.message)
}

// Grant the policy to a principal within a tenant context
const grantResult = await grantEntitlement({
  principalId: principal.id,          // the Principal receiving the entitlement
  policyId: policyResult.value.id,
  tenantId: tenant.id,                // null for platform-scoped policies
  grantedByPrincipalId: adminPrincipal.id,
})
```

## I need to check if a user can do something

> This is **access evaluation** — it checks whether a Principal has been granted a Policy that includes the requested action, optionally scoped to a specific Tenant.

```ts
// Action format: "resource:action" (e.g. "campaigns:update")
const access = await evaluateAccess({
  principalId: principal.id,
  action: 'campaigns:update',
  tenantId: tenant.id,   // include for tenant-scoped checks; platform entitlements always apply
})

if (access.success && access.value.allowed) {
  // Principal can perform this action in this tenant
}

// Pass a resource object for attribute-based condition checks (CASL conditions)
const conditionalAccess = await evaluateAccess({
  principalId: principal.id,
  action: 'campaigns:publish',
  tenantId: tenant.id,
  resource: { ownerId: principal.id, status: 'draft' },
})
```
