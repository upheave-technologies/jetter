---
description: "Server action discipline — thin adapters with five steps. Stack-agnostic; applies to any agent touching actions.ts."
paths:
  - "**/actions.ts"
  - "**/actions.tsx"
---

# server-actions.md — server action contract

Server actions are **thin adapters** between HTTP/UI and use cases. They do exactly five things and nothing else. Stack-agnostic; applies to any agent editing `actions.ts`.

---

## §1 — The five-step shape

Every server action does these five things in order:

1. **Authenticate** — resolve session; return UNAUTHENTICATED if missing.
2. **Extract input** — read `FormData` fields or function arguments.
3. **Presence-validate** — check required fields exist. NOT business validation.
4. **Call ONE use case** — a single pre-wired function.
5. **Return / revalidate / redirect** — map `Result` to `ActionResult`; on success call `revalidatePath` or `revalidateTag` if cached data is affected; optionally `redirect`.

```typescript
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createCampaign } from '@/modules/campaigns/application/createCampaignUseCase';
import { getSession } from '@/modules/campaigns/infrastructure/session';
import type { ActionResult } from '@/modules/campaigns/domain/types';

export async function createCampaignAction(
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
  // 1. Authenticate
  const session = await getSession();
  if (!session) {
    return { success: false, error: 'Unauthorized', code: 'UNAUTHENTICATED' };
  }

  // 2. Extract
  const name = formData.get('name') as string;
  const budget = formData.get('budget') as string;

  // 3. Presence-validate (NOT business validation)
  if (!name || !budget) {
    return { success: false, error: 'All fields required', code: 'VALIDATION_ERROR' };
  }

  // 4. Call ONE use case
  const result = await createCampaign({
    tenantId: session.tenantId,
    name,
    budget: parseFloat(budget),
  });

  // 5. Return / revalidate / redirect
  if (!result.success) {
    return { success: false, error: result.error.message, code: result.error.code };
  }
  revalidatePath('/campaigns');
  redirect(`/campaigns/${result.value.id}`);
}
```

**Why this shape:** The server action is a translation layer — it speaks HTTP/FormData on one side and domain types on the other. Keeping it thin (no logic, just translation) means every server action looks the same, reads in seconds, and contains zero business rules that could rot.

---

## §2 — What is FORBIDDEN in actions.ts

- **Business logic** → **violation**. Comparing dates/thresholds/status, conditional flows on entity state, multi-step orchestration — all belong in a use case. Actions don't decide; they delegate.
- **Calling multiple use cases in sequence** → **violation**. If a flow needs multiple steps, that's an orchestration use case in `application/`. The action calls the one orchestration.
- **Direct database / ORM / `fetch` calls** → **violation HIGH**.
- **Schema/table imports** → **violation HIGH**.
- **Throwing across the boundary** → **violation**. Map errors to `ActionResult` with a code.
- **Mutation without `revalidatePath` / `revalidateTag`** when cached data is affected → **violation**. Stale UI is a UX bug, not a feature.

The architecture-guard hook blocks ORM/db/schema/fetch in `actions.ts` at write time.

---

## §3 — Allowed import paths

```typescript
// ✅ CORRECT — direct imports from source files
import { register } from '@/modules/nucleus/application/registerUseCase';
import { setSession } from '@/modules/nucleus/infrastructure/session';
import type { ActionResult } from '@/modules/nucleus/domain/types';

// ❌ FORBIDDEN — composition root / repositories / private internals
import { nucleus } from '@/modules/nucleus/infrastructure/nucleus';
import { PrismaCampaignRepository } from '@/modules/campaigns/infrastructure/repositories/PrismaCampaignRepository';
```

**Allowed:**
- `@/modules/*/application/{verb}{Entity}UseCase` — pre-wired use case (each use case from its own file)
- `@/modules/*/domain/types` — public type definitions
- `@/modules/*/infrastructure/session` — session utilities
- `@/packages/@core/*` — core types
- `next/cache`, `next/navigation`, `next/headers`, `next/server`

**Forbidden:**
- `@/modules/*/infrastructure/nucleus` — composition root is PRIVATE
- `@/modules/*/infrastructure/repositories/*` — repository implementations are PRIVATE
- `@/modules/*/infrastructure/*` (anything but `session`) — adapters, database files are PRIVATE
- `@/modules/*/domain/*` (anything but `types`) — business logic, repository interfaces are PRIVATE
- ORM libraries (`drizzle-orm`, `@prisma/client`)
- Database client (`@/lib/db`)
- Direct query builders (`db.select`, `db.insert`, `db.update`, `db.delete`, `db.query`)

---

## §4 — Presence validation vs business validation

The server action does **presence validation** only — "are required fields present and parseable into expected types?". It does NOT do business validation — "is this email unique?", "is this date in the future?", "can this status transition?".

**Why:** Business rules belong in the domain layer where they're testable in isolation and reusable across server actions, route handlers, and use case orchestrations. Putting them in the action duplicates them at every entry point.

```typescript
// ✅ Presence validation in action
if (!name || !email || !password) {
  return { success: false, error: 'All fields are required', code: 'VALIDATION_ERROR' };
}

// ✅ Business validation in domain (called from the use case)
// domain/email.ts
export function validateEmail(email: string): Result<string, ValidationError> { ... }
```

For complex shape validation (Zod or similar) at the action boundary, that's acceptable. The rule is: don't make decisions that depend on entity state or business policy in the action.

---

## §5 — Idempotency for retriable callers

If a server action is invoked by a webhook handler, a queue consumer, or any retriable trigger, the use case it calls MUST be idempotent (see `architecture.md` §6 and the per-agent rules on idempotency).

The action itself is otherwise a one-shot, but it carries the contract — by calling an idempotent use case, retries don't duplicate side effects.

---

## §6 — Server Component pages follow the same import rules

Pages and layouts in `app/` follow the same direct-import rules as actions. See `page-architecture.md`.

---

## What the auditor checks against this file

When the diff touches `actions.ts` / `actions.tsx`, the auditor applies these rules:

- HIGH (FAIL): business logic in an action; direct DB/ORM/fetch in an action; multiple use case calls in one action; throwing across the boundary; mutation without `revalidatePath`/`revalidateTag`; missing auth check on a protected action.
- MEDIUM (WARN): excessive presence validation that crosses into business checks; complex Zod schema that should be a domain function.
- LOW (note): minor structural deviation from the five-step shape.

Findings tagged `server-actions §N`.

---

*Canonical contract for server actions. Stack-agnostic. Pairs with `page-architecture.md` and `react-components.md`.*
