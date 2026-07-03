# Connections — stack-kit

## Requires (on the operator's machine)

| Dependency | Why | Install hint |
|---|---|---|
| Docker (Engine or Desktop) | Runs the local stack containers | macOS: Docker Desktop; Linux: Docker Engine |
| Docker Compose v2 | Compose orchestration (`docker compose` plugin) | Ships with Docker Desktop; on Linux: `docker-compose-plugin` |
| Python 3 (stdlib only) | Manifest reader, dashboard server, port allocator | Preinstalled on macOS; `apt install python3` on Linux |
| `bash` ≥ 4 | The CLI and libs | Preinstalled (macOS bash 3.2 is fine; libs are POSIX-leaning) |
| `git` | Worktree detection, port allocator key | Already present in any Nucleus repo |
| `mkcert` + `nss` (optional) | Local HTTPS at `https://<slug>.loc` with a green padlock | `brew install mkcert nss` (macOS) |
| `ngrok` or `cloudflared` (optional) | `stack tunnel` for webhook testing | `brew install ngrok/ngrok/ngrok` |
| `ansible` (optional, VPS profile only) | VPS provisioning and vault | `brew install ansible` |

`stack doctor` checks each of these and tells you what's missing.

## Requires (Nucleus blocks, declared in `registry/index.yml`)

The `stack-kit` block has `dependencies: []` — it stands alone. The infra capability is composed at the preset level, where the `standard` preset bundles:

- `stack-kit` (this package)
- `infra` (agent) — `dependencies: [infra-rules]`
- `infra-rules` (the 13 commandments)
- The eight `skill-infra*` blocks — each `dependencies: [infra]`, plus `skill-infra-bootstrap: [infra, stack-kit]`

A consumer can install `stack-kit` on its own without the agent or skills, but the typical adoption path takes all 11 blocks together.

## Enables (what this kit unlocks for consumers)

| Capability | Consumed by |
|---|---|
| Uniform `stack up/down/ps/logs/psql/exec` lifecycle | Operators on every Nucleus project |
| Deterministic per-`(project, worktree)` port allocation | Multiple parallel worktrees of the same repo |
| Ephemeral sandbox environments (`stack sandbox create`) | AI agents running scenario tests in parallel |
| Reproducible scenario seeds (`stack seed apply`) | Test fixtures, bug repros, demo state |
| Cross-project dashboard at `http://localhost:42137` | "What do I have running?" inventory |
| Guided production triage runbooks | `/infra-prod-triage`, `/infra-cloud-triage` skills |
| Guided 6-phase secret rotation | `/infra-rotate-secret` skill |
| Profile-aware bootstrap (cloud / VPS / hybrid) | `/infra-bootstrap` skill |

## Consumed by (blocks that depend on this kit)

| Block | Reason |
|---|---|
| `skill-infra-bootstrap` | Renders the kit's templates into a new repo |
| `infra` (agent) | The agent's entire routing matrix delegates to `stack` subcommands |
| `skill-infra`, `skill-infra-seed`, `skill-infra-port-doctor`, `skill-infra-dashboard` | Front-ends for individual `stack` subcommands |
| `skill-infra-rotate-secret`, `skill-infra-prod-triage`, `skill-infra-cloud-triage` | Triage / rotation runbooks anchored to the kit's state and CLI |

The kit declares no outbound code dependencies on other Nucleus blocks. It is intentionally a leaf in the registry graph: any project that installs `stack-kit` gets a working operator surface even if no skill or agent block is installed alongside.

## State on the user's machine

The kit writes only inside two scopes:

- **The project tree** — `infra/_kit/` (read-only, kit-managed), `infra/.ports`, `infra/.compose.override.yml`, `infra/certs/` (all gitignored)
- **`~/.stack/`** — port registry, instance registry, secret rotation log, seed log, dashboard pidfile

Anything outside those — shell rc files, `~/.ssh/`, `/etc/hosts`, system trust stores, launchd/systemd units — is treated as user property and requires explicit in-conversation confirmation per [`AGENT.md`](AGENT.md) commandment three.
