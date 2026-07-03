---
name: spec
description: "Opt into deliberate spec-first planning for the current change-unit. Dispatches the `spec` agent in interactive mode to walk through Intent → Decisions → Acceptance/Tasks before any code is written. Use for substantial features, schema changes, architectural refactors, or anything you want to think through before building. The spec agent maintains SPEC.md as working memory either way; this command only changes whether the planning is deliberate (interactive) or silent (default)."
---

# /spec — Deliberate spec-first planning

Invoke this command when you want to **scope a change-unit before implementation**, instead of letting Claude work and maintain SPEC.md silently in the background.

## When to use

- New feature or capability surface
- Schema change
- Architectural refactor
- Multi-layer change (frontend + backend + schema)
- Removal/deprecation with downstream callers
- Anything you want to think through deliberately before code is written

## When NOT to use

- Bugfixes, tweaks, single-file edits, prototypes
- Anything where you'd rather just iterate

For all of those: just ask Claude for the change. SPEC.md is maintained silently in the background.

## What this command does

1. Dispatches the `spec` agent in **interactive mode**.
2. The agent walks through three short phases — pausing for your input between phases:
   - **Phase 1 — Intent** (5–10 focused questions): what's the goal, who benefits, edge cases, reproduction (for bugfixes), migration story (for removals).
   - **Phase 2 — Decisions** (1–3 questions): chosen approach, alternatives rejected, capability deltas.
   - **Phase 3 — Acceptance Criteria + Tasks**: proposed ACs (with `verify_via` directives) and tasks (with owner agents) — adjustable in dialogue.
3. Writes `system/context/{module}/features/{feature-slug}/SPEC.md`.
4. Returns a brief status: spec path, state, task count, AC count.

## After /spec finishes

Claude will:
- Show you the SPEC location.
- Ask if you want to start implementation now, or defer.
- If you start implementation, the orchestrator dispatches the implementing agents per the Tasks list, then runs `auditor` at the end and surfaces the CARD.

## Related

- **`/verify`** — run the auditor against the current SPEC at any time
- **`system/docs/verification-loop.md`** — full reference for the verification loop
- **`.claude/skills/spec/spec-template.md`** — the structure SPEC.md follows (bundled with this skill so it ships to downstream repos)
