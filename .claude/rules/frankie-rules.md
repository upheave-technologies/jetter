---
description: "Frankie-specific frontend contract — design system (Tailwind v4), accessibility floor, performance discipline, gap protocol with nexus. Read by frankie when producing UI, read by the auditor when verifying frontend work."
paths:
  - "app/**/_components/**"
  - "app/**/_containers/**"
  - "app/**/page.tsx"
  - "app/**/layout.tsx"
  - "app/**/template.tsx"
  - "app/**/loading.tsx"
  - "app/**/error.tsx"
  - "app/**/not-found.tsx"
  - "components/**"
---

# Frankie's Rules

Frankie-specific frontend rules. The cross-cutting React conventions live in `react-components.md` (component taxonomy, hooks containment) and `server-first-react.md` (the 'use client' decision tree, minimum client surface). The page contract lives in `page-architecture.md`. The engineering mindsets live in `architecture.md`. All those auto-inject when frankie touches matching files.

This file is the **frontend specialization** of those rules — what frankie must do beyond the cross-cutting contracts: design system, accessibility floor, performance.

## Scope

Frankie owns: `app/**/_components/**`, `app/**/_containers/**`, `components/**`, `app/globals.css`, JSX content inside `app/**/{page,layout,loading,error,not-found}.tsx` (replaces nexus's `return null` with the component tree).

Out of scope: data fetching, server actions, auth, middleware, caching (nexus); business logic / use cases / repositories (donnie); database schema (archie). The structural shell of `page.tsx` (`async function`, auth check, fetches) is read-only context — frankie modifies only the `return` statement.

---

## §1 — The nexus → frankie handoff (frankie side)

After nexus's phase, `page.tsx` ends with `return null`. Frankie replaces `null` with a single component invocation. Auth, fetches, error handling — unchanged.

Modifying nexus's data layer → **violation**. Frankie does not patch nexus's domain. Missing data or actions are handled via the gap protocol (`.claude/agents/frankie.md`).

**Why this split:** Specialization. Frankie focuses on visual presentation; nexus focuses on data. Mixing means files that nobody owns cleanly. The handoff is a contract — each agent reads the file at a known state and changes only its surface.

---

## §2 — Tailwind v4 and the design system

Tailwind v4 is CSS-first; there is no `tailwind.config.ts`. Theme tokens live in `app/globals.css` via `@theme`.

### §2.1 — Semantic tokens only

Approved color tokens: `primary`, `secondary`, `destructive`, `muted`, `accent`, `card`, `popover`, `border`, `input`, `ring`, `background`, `foreground` (and their `-foreground` variants).

Forbidden:
- Hardcoded color values: `bg-blue-600`, `text-amber-400`, `text-[#3b82f6]` → **violation MEDIUM**.
- Arbitrary scale values: `w-[247px]`, `mt-[13px]` → **violation MEDIUM**.

**Why:** A design system is only as consistent as its weakest link. Hardcoded values mean the dark-mode pass misses them, the brand refresh misses them, the accessibility audit misses them. Semantic tokens enforce consistency by construction.

If a design requires a value not in the system:
1. Add the CSS variable to `:root` in `app/globals.css`.
2. Map it in the `@theme` block.
3. Use the new semantic name in JSX.

### §2.2 — Variants with CVA

For component variants, use `class-variance-authority` (CVA). Inline ternaries for class strings → **concern**.

**Why:** CVA makes variants typed, exhaustive, and overrideable. Inline ternaries proliferate, drift, and become impossible to refactor.

### §2.3 — Component primitives — reuse > extend > create

- **shadcn/ui** for composed components (Button, Dialog, DropdownMenu). Customize via CSS variables, not by editing the shadcn source unless explicitly authorized.
- **Radix UI** for unstyled accessible primitives (when shadcn doesn't fit).
- **lucide-react** for icons. No other icon library.

Extending shadcn: add a variant via CVA, don't rewrite the component → **concern** if rewritten without justification.

---

## §3 — File organization

- **Atomic folders.** Every UI component in its own folder: `components/ui/Button/Button.tsx` or `app/{route}/_components/{Name}/{Name}.tsx`. Folder may contain `{Name}.spec.ts`, `{Name}.test.tsx`.
- **Colocation.** Cross-route reusable → `components/ui/{Name}/`. Single-route → `app/{route}/_components/{Name}/`.
- **Containers are files, not folders:** `app/{route}/_containers/{Name}Container.tsx`.

Premature promotion of a one-off to `components/ui/` "just in case" → **concern** (R9 — no premature abstraction; see `architecture.md` §9). Move when a second consumer appears.

**Why atomic folders:** When a component grows past a single file (tests, stories, specs, sub-components), the folder is already there to receive them. Refactor-time-to-folder is zero when the folder already exists.

---

## §4 — Design spec supremacy

If a `*.spec.ts` design spec exists for the component or page being built, it is the blueprint. Implement props, layout, and hierarchy exactly as defined.

The spec overrides general patterns. Implementing patterns that conflict with the spec → **violation**.

Spec search locations (frankie's agent body documents the procedure):
- `app/{route}/page.spec.ts`
- `app/{route}/_components/**/*.spec.ts`
- `components/ui/**/*.spec.ts`

**Why specs:** They are the contract between design and engineering. A spec captures the intent; the code captures the implementation. When they disagree, the spec wins by default.

---

## §5 — Accessibility floor

Every component meets this floor or doesn't ship:

- **Semantic HTML.** `<button>` for actions, `<a>` for navigation, `<form>` for inputs, semantic landmarks (`<nav>`, `<main>`, `<aside>`, `<header>`, `<footer>`). `<div onClick>` where `<button>` works → **violation HIGH**.
- **Form labels.** Every input has `<label htmlFor>` or `aria-label`. Naked input → **violation HIGH**.
- **Keyboard-reachable interactive elements.** Custom controls have `tabIndex={0}` + Enter/Space handlers. Missing → **violation MEDIUM**.
- **ARIA used only where semantic HTML can't express the meaning.** ARIA-sprinkling on already-semantic elements → **concern**.
- **Focus management on modals/dialogs.** Use Radix/shadcn Dialog primitives (focus trap + restore built in). Rolling your own → **concern**.
- **Alt text on every image.** Descriptive `alt` for content; empty `alt=""` for decorative. Missing → **violation HIGH**.
- **Contrast via designed token pairs.** `text-foreground` on `bg-background`; `text-primary-foreground` on `bg-primary`. Pairing tokens not designed to be paired → **concern**.
- **Don't disable focus outlines without replacement.** `outline-none` with no `focus-visible:` substitute → **violation MEDIUM**.

**Why:** Accessibility is not a feature; it is a default. The cost of accessibility-as-an-afterthought is rebuilding components. The cost of accessibility-as-a-floor is zero — semantic HTML is shorter than `<div>`-soup.

---

## §6 — Performance

- **`next/image` for every image; never raw `<img>`** → **violation MEDIUM**.
- **Explicit `width` + `height` (or `fill` + container).** Missing causes layout shift → **violation MEDIUM**.
- **`sizes` set on responsive images.** Missing ships the largest variant to mobile → **concern**.
- **`priority` set on the LCP image** (one per page, usually the hero). Missing regresses LCP → **concern**.
- **`next/font` for every font; no Google Fonts via `<link>`** → **violation MEDIUM**.
- **`<Link>` (from `next/link`) for internal navigation; never `<a href>` for internal routes** → **violation MEDIUM**.
- **External links use `rel="noopener noreferrer"` on `target="_blank"`** → **violation HIGH** (security).
- **Heavy client-only components use `next/dynamic` with `{ ssr: false }`.**
- **Below-the-fold heavy content uses `<Suspense>` or virtualization.**

**Why:** Performance is paid by users on every page load. The cost of a missed `priority` is felt by everyone who lands on the page. The cost of getting it right is one prop.

---

## What the auditor checks against this file

When the diff touches files under frankie's paths, the auditor reads this file (plus react-components.md, server-first-react.md, page-architecture.md) and reasons section-by-section. Severity:

- HIGH (FAIL): missing form label; `<div onClick>` instead of `<button>`; missing `alt` on image; raw `<img>` instead of `next/image`; missing `rel="noopener"` on `target="_blank"`.
- MEDIUM (WARN): hardcoded color/size values; missing `sizes` / `priority` on what looks like the LCP image; missing `width`/`height` on `next/image`; missing keyboard handlers on custom interactive control; missing `focus-visible:` after `outline-none`.
- LOW (note): CVA absent for variants; primitive reinvented when shadcn/Radix would do; speculative promotion of one-off to `components/ui/`.

Card section: `frankie's rules — frankie-rules.md`. Findings tagged by section (e.g., `§2.1 hardcoded color`, `§5 missing form label`, `§6 raw <img>`).

No softening. False positives are cheaper than false negatives.

---

*Frontend-specific rules. Cross-cutting React conventions live in `react-components.md` and `server-first-react.md`. Page contract in `page-architecture.md`. Engineering mindsets in `architecture.md`. Templates, workflow, gap protocol, implementation report live in `.claude/agents/frankie.md`.*
