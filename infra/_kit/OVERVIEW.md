# stack-kit

The Nucleus Stack Kit — a self-contained operational toolkit that gives every Nucleus project the **same** local-dev, sandbox, and triage surface. One bash CLI (`stack`), one cross-project dashboard, one set of bootstrap templates for cloud (Vercel + Neon) or VPS (Docker + Caddy + Ansible) deploys.

Installs read-only to `infra/_kit/` in every consumer project. Nucleus dogfoods its own kit via a symlink at `infra/_kit` → `registry/kits/stack/`.

## Owns

- The `stack` CLI and `stack-dashboard` server (`bin/`)
- Bash library that powers every subcommand: ports, compose, doctor, lifecycle, sandbox, seed, TLS, prod, state (`lib/`)
- Bootstrap templates for cloud / VPS / hybrid profiles (`templates/`)
- Reproducible scenario-seed runner and example seeds (`seeds/`)
- Cross-project state at `~/.stack/` (port registry, instance registry, rotation log, seed log)
- The cross-project dashboard at `http://localhost:42137`
- Bats integration test suite (`test/`)

## Does Not Own

- Application code, business logic, ORM schemas, migrations
- The consumer project's `infra/.env`, `infra/docker-compose.dev.yml`, `Dockerfile.<app>`, `Caddyfile.*` — those are rendered from templates the **first time** `/infra-bootstrap install` runs, then the consumer owns them
- Secret values (the kit guides rotation; the user executes every step)
- The user's machine config — never edits `~/.zshrc`, `~/.ssh/*`, `/etc/hosts`, trust stores, launchd/systemd without explicit per-action confirmation
- Production deployment side-effects — VPS deploy is `ansible-playbook` the user runs; cloud deploy is Vercel/Neon the user wires
- The `infra` agent itself (ships separately as `.claude/agents/infra.md`) or any of the eight `infra-*` skills

## Status

Stable. 47 files. Installs idempotently via `/infra-bootstrap`. Ships with 58 bats integration tests + 4 Nucleus CLI tests. Dogfooded on Nucleus's own `app/`.

## Where to next

| You want… | Read |
|---|---|
| The operator how-to — `stack` commands, sandboxes, manual mode, FAQ | [`USAGE.md`](USAGE.md) |
| The full agent-facing reference (triage, secret rotation, drift logging) | [`AGENT.md`](AGENT.md) |
| What this kit requires, what it unlocks, who consumes it | [`CONNECTIONS.md`](CONNECTIONS.md) |
| HTTPS / mkcert / local TLS — deep dive | [`TLS.md`](TLS.md) |
| Known-missing pieces and field notes | [`GAPS_AND_ROADMAP.md`](GAPS_AND_ROADMAP.md) |
