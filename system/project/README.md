# `system/project/` — Project Identity

This folder is the universal slot for **project-specific context** that every AI agent should know about this repository.

## What goes here

Anything that describes **what this project IS** — its mission, nature, tech stack, philosophy, constraints, vocabulary. Things that change how agents should reason about this codebase.

There is **no fixed schema**. Drop in whatever `*.md` files make sense for this project. Common examples:

- `mission.md` — what the project is, who it serves, why it exists
- `nature.md` — internal / pilot / production; lifecycle; how careful to be
- `tech-stack.md` — runtime, frameworks, package manager, deploy target
- `philosophy.md` — how decisions get made; what this project optimizes for
- `glossary.md` — domain vocabulary
- `constraints.md` — non-negotiables specific to this project

One file or many — whatever feels natural. Name files however you like.

## How agents use it

Every agent (orchestrator and subagents) is instructed by their definition to **read every `*.md` file in this folder before starting work**. Project-identity content here overrides generic agent behavior where they disagree.

If the folder is empty or missing, agents fall back to generic behavior. So this folder is **optional but authoritative**: optional in the sense that a project doesn't need to fill it in, authoritative in the sense that when content exists, it wins.

## What does NOT go here

- **Universal Nucleus rules** — those live in `CLAUDE.md` and `.claude/rules/` and propagate to every project.
- **Working memory for in-flight features** — those live in `system/context/{module}/features/{feature}/SPEC.md`.
- **Internal documentation** about how the system works — that lives in `system/docs/`.
- **Code, schemas, or implementations** — those live in `packages/`, `modules/`, and `app/`.

This folder is the answer to: *"What does an agent need to know about this specific project that it wouldn't know from any other project?"*
