---
description: "Next.js page.tsx / layout.tsx contract — server components only, no hooks, no raw HTML JSX. Stack-agnostic — applies to any agent touching page/layout files."
paths:
  - "**/page.tsx"
  - "**/layout.tsx"
  - "**/template.tsx"
---

# page-architecture.md — page.tsx / layout.tsx contract

Every `page.tsx` and `layout.tsx` in `app/` is a **Server Component**. No exceptions. Stack-agnostic; applies to any agent touching these files.

---

## §1 — The page contract

A page file does exactly three things in order:

1. **Authenticate** — check session, redirect if unauthorized.
2. **Fetch data** — call use cases via direct imports from each use case file.
3. **Delegate rendering** — return a single component with data as props.

```tsx
// ✅ CORRECT — page.tsx
import { redirect } from 'next/navigation';
import { getSessionPrincipalId } from '@/modules/nucleus/infrastructure/session';
import { getProfile } from '@/modules/nucleus/application/getProfileUseCase';
import { DashboardView } from './_components/dashboard-view';

export default async function DashboardPage() {
  const principalId = await getSessionPrincipalId();
  if (!principalId) redirect('/login');

  const result = await getProfile({ id: principalId });
  if (!result.success) redirect('/login');

  return <DashboardView principal={result.value} />;
}
```

**Why this shape:** The page is the seam between routing and rendering. It does the auth/authz gate, fetches data once on the server, and delegates rendering to a single component. Keeping pages thin makes them obvious — anyone reading a page sees exactly what data it needs and where it delegates.

---

## §2 — What is FORBIDDEN in page.tsx / layout.tsx / template.tsx

| Forbidden | Why | Where it belongs |
|-----------|-----|-----------------|
| `'use client'` | Pages are always Server Components | `_containers/*.tsx` |
| `useState`, `useEffect`, any hook | Client state has no place in a server component | `_containers/*.tsx` |
| Raw HTML (`<div>`, `<form>`, `<input>`, etc.) | Pages delegate rendering, they don't render | `_components/*.tsx` or `_containers/*.tsx` |
| Event handlers (`onClick`, `onSubmit`, etc.) | These require client runtime | `_containers/*.tsx` |
| `window`, `document`, browser APIs | Server components have no browser | `_containers/*.tsx` |
| Direct database access — ORM imports, `db.*` calls, schema imports | The layer cake (ddd-architecture §1) | `infrastructure/repositories/**` via use cases |
| `fetch()` to the app's own `/api/*` routes | Use cases are called directly in Server Components | direct use case call |

The architecture-guard hook (Rule 11) blocks any write to `page.tsx` containing `'use client'`, React hooks, or raw HTML JSX tags. This is enforced at write time.

---

## §3 — `searchParams` in Next 15+

`searchParams` is `Promise<...>`. Always `await` before reading:

```tsx
type SearchParams = { search?: string; page?: string };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  // ...
}
```

Same for dynamic route `params` — they are also Promises.

---

## §4 — generateMetadata

For dynamic metadata depending on URL params or fetched data:

```tsx
import type { Metadata } from 'next';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const result = await getResource({ id });
  if (!result.success) return { title: 'Not found' };
  return { title: result.value.name };
}
```

Static metadata uses `export const metadata: Metadata = { ... }`. Both follow the same direct-import rule (use case calls, no DB).

---

## §5 — error.tsx / loading.tsx / not-found.tsx

Every route segment that fetches data has these three siblings:

- **`error.tsx`** — error boundary. Must be a client component (`'use client'` is allowed here only — Next.js framework requirement).
- **`loading.tsx`** — instant-shown skeleton during data fetch.
- **`not-found.tsx`** — rendered when `notFound()` is called or a dynamic segment returns null.

Use `notFound()` from `next/navigation` in pages for expected-missing cases:

```tsx
import { notFound } from 'next/navigation';

const result = await getResource({ id });
if (!result.success || !result.value) notFound();
```

Don't `throw` in pages for expected-missing cases. `throw` triggers `error.tsx` (500 UX). `notFound()` triggers `not-found.tsx` (404 UX). They're different errors.

---

## What the auditor checks against this file

When the diff touches `page.tsx` / `layout.tsx` / `template.tsx`, the auditor applies these rules:

- HIGH (FAIL): `'use client'` in a page; React hooks in a page; raw HTML JSX in a page; ORM/db imports in a page; missing auth check on a protected route; `fetch()` to own `/api/*` from a page.
- MEDIUM (WARN): `throw` for expected-missing case (should be `notFound()`); missing `loading.tsx` on a slow route.
- LOW (note): minor structural deviation.

Findings tagged `page-architecture §N`.

---

*Canonical contract for Next.js pages and layouts. Stack-agnostic. Pairs with `server-first-react.md` and `react-components.md`.*
