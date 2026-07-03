---
name: verify
description: "Manually run the engineering excellence auditor on the current diff. Dispatches the `auditor` subagent which reads architecture.md (engineering mindsets §1–§17) + project-structure.md plus every stack rule file (ddd-architecture, react-components, server-first-react, page-architecture, server-actions) and per-agent rule file (donnie-rules, nexus-rules, frankie-rules, archie-rules) whose paths match the diff, and reasons brutally about whether the diff follows them. Returns a card with the verdict. Use mid-flight, after a switch, or any time you want a status check. The auditor-trigger Stop hook fires this automatically at the end of code-bearing work; this command is for explicit on-demand invocation."
---

# /verify — Run the engineering excellence auditor on demand

Invoke this command to manually trigger the **engineering review** on the current diff. The auditor reads the changes, reads `.claude/rules/architecture.md` (engineering mindsets §1–§17 plus the principles extension mechanism) and `.claude/rules/project-structure.md`, plus every stack rule file (`ddd-architecture.md`, `react-components.md`, `server-first-react.md`, `page-architecture.md`, `server-actions.md`) and per-agent rule file whose `paths:` frontmatter matches files in the diff, reasons about whether the diff follows the rules, and returns a card.

The Stop hook fires the auditor automatically at the end of any code-change-bearing pass — `/verify` is for explicit on-demand invocation when you want a status check mid-flight or after a switch.

## Scope

The auditor verifies **adherence to the rules** in `.claude/rules/`. Same rules the producer agents (donnie, nexus, frankie, archie) read when writing code — same byte-string, no drift.

Coverage:
- **architecture.md** (R1–R9) — cross-cutting layer boundaries, axioms of isolation and data sovereignty, public API surface, server-first React, soft-delete discipline, no half-finished work, no premature abstraction.
- **donnie-rules.md** — backend code: use cases, repositories, domain logic, idempotency, code shape (the eleven commandments), capability sidecars.
- **nexus-rules.md** — Next.js server-side: pages, server actions, route handlers, middleware, caching, streaming, auth, edge vs node runtime.
- **frankie-rules.md** — frontend: component taxonomy, server-first React, forms, design system, accessibility, performance.
- **archie-rules.md** — database: schema, migrations, indexes, partial unique indexes, the Ten Commandments of Data Modeling.

The auditor reads `architecture.md` always, plus the per-agent files whose `paths:` frontmatter matches changed files in the diff. It reports findings grouped by source rule file in the card.

It does **not** verify functional correctness (whether the diff matches Intent, whether endpoints behave, whether scenarios pass). Functional verification is a future phase.

Mechanical correctness (`pnpm tsc --noEmit`, dead-code detection via `--noUnusedLocals --noUnusedParameters`, capability drift) is enforced separately by the build-check Stop hook — the auditor trusts that floor has been enforced before it runs.

## What this command does

1. Dispatches the `auditor` subagent.
2. Auditor reads the git diff.
3. Auditor reads `architecture.md` and every per-agent rule file whose `paths:` match changed files.
4. Auditor deep-reads every changed `*UseCase.ts` file in full (to apply code-shape rules from donnie-rules.md §7).
5. Auditor reasons brutally about violations, concerns, and notes. No softening.
6. Auditor returns a card with findings grouped by source rule file.
7. If an active SPEC.md matches the changed paths, auditor also writes the card/verdict/worklog into it.
8. Orchestrator surfaces the card and asks what to do based on the verdict.

## Verdict outcomes

- **PASS** → orchestrator asks: "May I commit?"
- **PASS with notes** → surfaces the notes, asks: "May I commit?"
- **WARN** → surfaces concerns, asks how to proceed
- **FAIL** → surfaces violations and likely-owner agent, asks how to proceed

The orchestrator never auto-iterates in chat. You decide.

## Related

- **`/spec`** — opt into deliberate spec-first planning
- **`system/docs/verification-loop.md`** — full reference
- **`.claude/agents/auditor.md`** — auditor's full responsibility definition
