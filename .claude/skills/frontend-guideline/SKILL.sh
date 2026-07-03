---
description: Authoritative guidelines for building production-grade React components. Use this skill when creating new UI, refactoring components, or implementing designs. It enforces Server Component defaults, strict state/presentation separation, and Tailwind v4 design system compliance.
context: fork
agent: frankie
---

# React Component Architecture Protocols

You are an expert React architect. Follow these protocols strictly when generating or modifying UI components.

## 1. The Server Component Default (Commandment Zero)

**Rule:** Every component must be a **Server Component** (`.tsx`) by default.
**Exception:** Use `'use client'` *only* when absolutely necessary for interaction.

### ❌ Bad Pattern: Client Component by Default

Degrading an entire component to client-side just for one button.

```tsx
'use client' // ❌ Entire card becomes client-side
export function ProductCard({ product }) {
  const [liked, setLiked] = useState(false)
  return (
    <div>
      <img src={product.img} /> {/* Static: Should be server */}
      <h1>{product.name}</h1>   {/* Static: Should be server */}
      <button onClick={() => setLiked(!liked)}>Like</button>
    </div>
  )
}
```

### ✅ Good Pattern: Interactive Islands

Isolate state into tiny "island" components.

```tsx
// ProductCard.tsx (Server Component)
export function ProductCard({ product }) {
  return (
    <div>
      <img src={product.img} />
      <h1>{product.name}</h1>
      <LikeButton id={product.id} /> {/* ✅ Interactive Island */}
    </div>
  )
}

// LikeButton.tsx (Client Component)
'use client'
export function LikeButton({ id }) {
  const [liked, setLiked] = useState(false)
  return <button onClick={() => setLiked(!liked)}>Like</button>
}
```

## 2. Strict State vs. Presentation Separation

Maintain absolute separation between "Smart" containers and "Dumb" presentational components.

| Type | Path Pattern | Responsibility | Allowed Hooks |
|------|--------------|----------------|---------------|
| **Presentational** | `_components/{Name}/*.tsx` | Visuals & Props | **NONE** (except `useFormStatus`) |
| **Container** | `_containers/{Name}Container.tsx` | Logic & State | `useState`, `useEffect`, etc. |

### ❌ Bad Pattern: Mixed Concerns

```tsx
// app/login/_components/LoginForm.tsx
export function LoginForm() {
  // ❌ VIOLATION: State inside a presentational _component
  const [email, setEmail] = useState('') 
  
  return <input value={email} onChange={e => setEmail(e.target.value)} />
}
```

### ✅ Good Pattern: Container/Component Split

```tsx
// app/login/_containers/LoginFormContainer.tsx
'use client'
export function LoginFormContainer() {
  // ✅ Logic lives here
  const [state, action] = useFormState(loginAction, null)
  return <LoginForm state={state} action={action} />
}

// app/login/_components/LoginForm/LoginForm.tsx
// ✅ Pure presentation (Server Component)
export function LoginForm({ state, action }) {
  return (
    <form action={action}>
      <input name="email" className="border-border" />
    </form>
  )
}
```

## 3. Design System & Styling (Tailwind v4)

**Rule:** ZERO hardcoded values. Use semantic tokens only.

### ❌ Bad Pattern: Hardcoded/Arbitrary Values

```tsx
<div className="bg-blue-600 w-[240px] text-[#333]"> 
  <!-- ❌ blue-600: Hardcoded color -->
  <!-- ❌ w-[240px]: Arbitrary value -->
  <!-- ❌ #333: Magic hex code -->
  Content
</div>
```

### ✅ Good Pattern: Semantic Tokens

```tsx
<div className="bg-primary w-64 text-foreground">
  <!-- ✅ bg-primary: Semantic token -->
  <!-- ✅ w-64: Standard spacing scale -->
  <!-- ✅ text-foreground: Semantic token -->
  Content
</div>
```

## 4. Design Spec Supremacy

**Rule:** Always search for a `.spec.ts` file before implementing.

* **Priority:** `*.spec.ts` > Design Image > General Best Practices.
* **Action:** If `components/ui/Button/Button.spec.ts` exists, you MUST implement the props and structure exactly as defined.

## 5. Forms & Actions

**Rule:** Prefer Server Actions over client-side fetch.

* Use `useFormStatus` for loading states.
* Use `useFormState` for validation errors.
* Do NOT use `onSubmit` handlers with `event.preventDefault()` unless creating a complex wizard.

## 6. Reuse Protocol

Before creating a new component:

1. **Search:** Check `components/ui/` for existing matches.
2. **Evaluate:** Can an existing component be extended with a variant?
3. **Refactor:** Prefer refactoring a `Card` to support a "compact" variant over creating `CompactCard`.