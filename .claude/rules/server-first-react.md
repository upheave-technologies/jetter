---
description: "Server Components by default. The 'use client' decision tree. Minimum client surface principle. Stack-agnostic — applies to any agent touching .tsx files."
paths:
  - "app/**/*.tsx"
  - "app/**/_containers/**"
  - "app/**/_components/**"
---

# server-first-react.md — Server Components by default

Every `.tsx` file is a Server Component unless there is a concrete, unavoidable reason to make it a client component. Stack-agnostic; applies to any agent editing `.tsx` files.

---

## §1 — Why server-first

Every `'use client'` directive ships JavaScript to the browser. Less JavaScript means faster pages, smaller bundles, less hydration cost, fewer client-side state bugs.

Server Components run on the server, fetch data directly, return rendered HTML. Client Components run in the browser, manage state, respond to events. The split is real and meaningful — opting into client behavior should be a deliberate decision, not the default.

**Why this matters:** A team that defaults to client components ships an SPA pretending to be a server app — losing every advantage of the App Router. A team that defaults to server components ships fast pages by construction.

---

## §2 — Where `'use client'` is allowed

`'use client'` is ONLY permitted in:

| Location | Purpose |
|----------|---------|
| `_containers/*.tsx` | ONLY when the container genuinely needs client interactivity (state, hooks, browser APIs) — see §3 |
| `error.tsx` | Next.js framework requirement for error boundaries |

Anywhere else → **violation** (architecture-guard Rule 12 hard-blocks at write time).

**Containers do NOT require `'use client'`.** Most containers should be server components. Only add `'use client'` when the container manages genuinely interactive state.

---

## §3 — The `'use client'` decision tree

Before adding `'use client'` to ANY file, answer these four questions in order. If you answer "no" to all four, the file MUST be a Server Component.

### 1. Does this need `useState` or `useReducer`?

- Can the state live in the URL instead? → use a Server Component reading `searchParams`.
- Is it form input state? → use uncontrolled inputs with `<form action={serverAction}>`.
- Is it truly ephemeral UI state (open/closed, hover, selection)? → yes, you need a client component.

### 2. Does this need `useEffect`?

- Is it fetching data on mount? → **NEVER**. Fetch in the Server Component and pass as props. `useEffect(..., [])` for data fetching is a **violation HIGH** (architecture-guard Rule 13 hard-blocks).
- Is it a genuine browser-side effect (resize listener, IntersectionObserver, timer, subscription)? → yes, client.

### 3. Does this need an event handler (`onClick`, `onChange`, etc.)?

- Is it a form submission? → use `<form action={serverAction}>` — no `onClick` needed.
- Is it navigation? → use `<Link>` or `redirect()` in a server action.
- Is it truly interactive (toggle, drag, animation trigger, real-time)? → yes, client.

### 4. Does this need browser APIs (`window`, `document`, `localStorage`, `IntersectionObserver`, `clipboard`)?

- Yes → client.

**If you answered "no" to all four, the file MUST be a Server Component.** Adding `'use client'` anyway → **violation**.

---

## §4 — The minimum client surface principle

If something CAN be a Server Component, it MUST be a Server Component.

When a feature contains both server-possible and client-necessary work, decompose them into separate components. The server-possible parts stay as Server Components. Only the genuinely client-necessary part becomes a client component — the smallest possible leaf.

**Never bundle server-possible work with client-necessary work in a single `'use client'` file.**

**Why:** Every `'use client'` directive ships JavaScript to the browser. Bundling server-possible work into a client component ships JavaScript that could have been rendered on the server. The cost is paid forever, on every page load, by every visitor.

### The decomposition test

Before writing ANY client container, ask: "Does every piece of this container genuinely need client state?"

If even one form, one section, or one button could work as a server component with `<form action={...}>` — decompose. Extract the server-possible parts into `_components/` as Server Components. The client container shrinks to only the irreducible interactive core.

---

## §5 — The common anti-patterns

### useEffect for data fetching — the most common violation

```tsx
// ❌ WRONG — client-side data fetching
'use client';
import { useEffect, useState } from 'react';

export function DataContainer() {
  const [data, setData] = useState(null);
  useEffect(() => {
    fetch('/api/data').then(r => r.json()).then(setData);
  }, []);
  return data ? <DataView data={data} /> : <p>Loading...</p>;
}
```

```tsx
// ✅ CORRECT — server-side data fetching in page.tsx
import { getData } from '@/modules/mymodule/application/getDataUseCase';

export default async function Page() {
  const data = await getData();
  return <DataView data={data} />;
}
```

### useState for every form field

```tsx
// ❌ WRONG — controlled form with client state for every field
'use client';
import { useState } from 'react';

export function FormContainer() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  // ...
}
```

```tsx
// ✅ CORRECT — uncontrolled form with server action
// No 'use client' needed
export function CreateForm() {
  return (
    <form action={createAction}>
      <input name="name" />
      <input name="email" />
      <button type="submit">Create</button>
    </form>
  );
}
```

### useRouter for post-mutation navigation

```tsx
// ❌ WRONG — client-side navigation after mutation
'use client';
import { useRouter } from 'next/navigation';

const router = useRouter();
async function handleSubmit(formData) {
  await createAction(formData);
  router.push('/dashboard');
}
```

```tsx
// ✅ CORRECT — redirect in the server action
'use server';
import { redirect } from 'next/navigation';

export async function createAction(formData: FormData) {
  await create(...);
  redirect('/dashboard');
}
```

---

## §6 — When client components ARE correct

These patterns genuinely need `'use client'` in a `_containers/` file:

- **Optimistic UI** — `useOptimistic` for instant feedback before server confirms
- **Real-time updates** — WebSocket subscriptions, SSE listeners
- **Complex form interactions** — multi-step wizards, dependent dropdowns, drag-and-drop
- **Animations** — framer-motion, CSS transition orchestration
- **Browser APIs** — clipboard, geolocation, media devices, canvas
- **Third-party client libraries** — maps, charts, rich text editors

Even then: the client container is slim. It manages the interactive bit; rendering delegates to `_components/`.

---

## What the auditor checks against this file

When the diff touches `.tsx` files, the auditor applies this file's rules:

- HIGH (FAIL): `'use client'` outside `_containers/` or `error.tsx`; `useEffect(..., [])` calling fetch/server-action/repo in `_containers/`; data fetching in any client component.
- MEDIUM (WARN): client container with state for fields that could be uncontrolled; client container bundling server-possible siblings; useRouter for post-mutation navigation.
- LOW (note): unjustified client component without state/effects/browser APIs.

Findings tagged `server-first-react §N`.

---

*Canonical contract for server-first React. Stack-agnostic. Pairs with `react-components.md` (component taxonomy) and `page-architecture.md` (page contract).*
