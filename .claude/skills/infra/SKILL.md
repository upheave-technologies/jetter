---
name: infra
description: "Top-level infrastructure operator skill. Drives the local stack lifecycle (up/down/restart/logs/psql/exec/reset), inspects state (ps/ports/doctor), exposes the local tunnel, and routes to specialized skills (/infra-seed, /infra-port-doctor, /infra-rotate-secret, /infra-prod-triage, /infra-cloud-triage, /infra-bootstrap, /infra-dashboard). Invoke for ANY infrastructure question that isn't more specifically owned by another /infra-* skill."
---

# /infra — The Operator Menu

You are operating as **infra** in single-task mode. This skill is the default entry point for any infrastructure work in any Nucleus-based project. It owns the local-stack lifecycle and dispatches to specialized skills when the request has a sharper shape.

---

## Invocation patterns

| Command | Action |
|---|---|
| `/infra` | Show stack status + menu of available actions |
| `/infra up [--profile <name>] [--seed <scenario>]` | Boot the **primary** local stack. For ad-hoc / parallel / AI test work, use `/infra sandbox create` instead. |
| `/infra down [--volumes]` | Stop the stack (optionally drop DB volumes) |
| `/infra restart [<service>]` | Restart core or named service |
| `/infra logs [<service>] [--follow] [--since 10m]` | Tail container logs |
| `/infra ps` | Show running services for this worktree |
| `/infra ports` | Show port allocation for this worktree |
| `/infra psql [<args>]` | Open psql against the local DB |
| `/infra exec <cmd>` | Run a command inside the main app container |
| `/infra reset` | Nuke containers + volumes for this worktree (with confirmation) |
| `/infra doctor` | Diagnose docker, ports, env files, kit version |
| `/infra tunnel [provider]` | Expose the local stack via ngrok / cloudflared / portless |
| `/infra tls install` | Generate locally-trusted HTTPS cert (mkcert) for `<slug>.loc` |
| `/infra tls status` | Inspect cert: path, issuer, expiry, trust-chain verification |
| `/infra tls renew` | Regenerate the cert (same as `install`; idempotent) |
| `/infra tls uninstall` | Delete the project's cert files (does NOT remove mkcert's CA) |
| `/infra lifecycle list` | Show manifest-declared `post_up` / `pre_down` hooks |
| `/infra lifecycle run <phase>` | Run one lifecycle phase ad-hoc (e.g., after manual DB reset) |
| `/infra up --no-hooks` | Boot without running the `post_up` chain (advanced) |
| `/infra sandbox create [--name X] [--ttl 1h] [--quiet]` | Spawn an isolated, time-boxed copy of the stack for testing |
| `/infra sandbox list` | All active sandboxes across all your projects |
| `/infra sandbox destroy <id> \| --all` | Tear down one, multiple, or all sandboxes for this project |
| `/infra sandbox <id> <subcommand>` | Run any normal subcommand scoped to that sandbox (ps/psql/exec/logs/seed/lifecycle) |
| `/infra sandbox gc` | Reap expired sandboxes (also auto-runs lazily) |
| `/infra dashboard` | Start (or focus) the cross-project dashboard at :42137 |

If the user's intent isn't in this table, **stop and route**:

| Signal | Route to |
|---|---|
| seed / scenario / test data | `/infra-seed` |
| port conflict / address in use | `/infra-port-doctor` |
| rotate secret / leak / compromise | `/infra-rotate-secret` |
| prod webhook / prod logs / prod db | `/infra-prod-triage` |
| vercel / neon / preview deploy | `/infra-cloud-triage` |
| set up infra in a new project | `/infra-bootstrap` |
| dashboard details | `/infra-dashboard` |

---

## Protocol — every run starts here

```bash
# 1. State (always)
infra/_kit/bin/stack doctor --quiet || infra/_kit/bin/stack doctor

# 2. Profile inference (look at infra/_kit/manifest.yaml for "default_profile")
# 3. Blast-radius declaration (one sentence — see infra Commandment Two)
# 4. Action
# 5. Verification (re-run state)
# 6. Report
```

If the project does not have `infra/_kit/` installed, the right move is `/infra-bootstrap`. Do not improvise compose files inline.

---

## Up — the most common path

```bash
infra/_kit/bin/stack up
```

What happens, in order:
1. `stack doctor` runs (silently if everything's fine).
2. The port allocator computes ports for `(project_slug, worktree_branch)` and writes `infra/.ports`.
3. Compose project name is set to `<slug>_<worktree>` so multiple worktrees coexist.
4. The chosen profile's compose file is selected (`docker-compose.dev.yml` by default).
5. `docker compose up -d --build` runs.
6. The instance is registered in `~/.stack/registry.json`.
7. The dashboard at :42137 is started if it isn't already.
8. Final report prints: name, profile, URLs (incl. portless URL if available), ports, log tail command.

**`--ephemeral` was removed** — superseded by `stack sandbox create`. Sandboxes are properly isolated (no host ports, separate registry, TTL-based GC) and don't share the primary's port bindings. Use `stack sandbox` for any short-lived isolated work; `stack up` is for the human's primary stack.

---

## Down — and the volume question

```bash
infra/_kit/bin/stack down              # keep DB volume
infra/_kit/bin/stack down --volumes    # drop DB volume
```

Always declare the blast radius:
- Plain `down`: containers gone, volumes preserved. Next `up` resumes the same DB.
- `down --volumes`: containers gone, DB gone. Next `up` starts from a fresh schema (migrations re-run, scenarios re-seed).

Default to plain `down` unless the user explicitly says "wipe" / "reset" / "fresh" / "drop".

---

## Logs — local vs. prod

| Where | Command |
|---|---|
| Local | `stack logs core --follow` |
| Local with grep | `stack logs core --since 10m | grep -i error` |
| Prod (VPS) | route to `/infra-prod-triage` — there are four sources of truth, not one |
| Prod (Vercel) | route to `/infra-cloud-triage` |

Always pass `--timestamps` for local-stack logs (the kit does this by default). Without timestamps, the lines have no time anchor.

---

## Psql — local vs. prod

```bash
infra/_kit/bin/stack psql                                # interactive shell
infra/_kit/bin/stack psql -c 'SELECT count(*) FROM x'    # one-shot
```

For prod, never `stack psql --target prod` — that operation does not exist. Connect via SSH tunnel through `/infra-prod-triage`.

---

## Tunnel — exposing localhost to the internet

```bash
infra/_kit/bin/stack tunnel                # uses default from manifest (ngrok or cloudflared)
infra/_kit/bin/stack tunnel cloudflared    # explicit
infra/_kit/bin/stack tunnel portless       # if portless is installed
```

The tunnel is for webhook receipt (GitHub Apps, Slack Apps, Stripe, etc.). After the tunnel starts, **remind the user**: provider webhook URLs must be updated to the new tunnel URL.

---

## Reset — the destructive option

```bash
infra/_kit/bin/stack reset
```

This is `down --volumes` + a confirmation prompt + the registry entry removed. The user must say "yes drop the database" (Commandment Three unlock phrase).

---

## Dashboard

```bash
infra/_kit/bin/stack dashboard            # opens / focuses the dashboard
```

Dashboard lives at `http://localhost:42137` and shows every running instance across every project + worktree on this machine. See `/infra-dashboard` for the full protocol.

---

## Reporting

For every `up`, `reset`, or production-adjacent action, end with the Infra Report block. For trivial reads (`ps`, `ports`, single log tail), a one-liner is fine.

---

## Self-check before reporting "done"

- [ ] Did I run `stack ps` (or equivalent) before AND after the action?
- [ ] Did I declare blast radius for any non-trivial action?
- [ ] Did I route to a more specialized skill when one was a better fit?
- [ ] Did I leave the dashboard reflecting the current state?
- [ ] Did I capture any drift (unexpected state, surprise step) in `infra/_kit/AGENT.md` field notes?
