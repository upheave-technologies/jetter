# Usage — stack-kit

The operator how-to for the Nucleus Stack Kit. For "what is this and what does it own", read [`OVERVIEW.md`](OVERVIEW.md). For the full agent-facing reference and triage manual, read [`AGENT.md`](AGENT.md).

`stack up` works the same in every Nucleus project that has the kit installed — Demoapp, Cerebro, Landing, whatever you're building next. This file walks through the daily-use commands, sandboxes, manual mode, and the FAQ.

---

## Quick start

From the repo root:

```bash
# 1. Sanity-check your environment
infra/_kit/bin/stack doctor

# 2. Copy the env template (first time only)
cp infra/.env.example infra/.env
# …then open infra/.env and fill in your dev secrets

# 3. Boot it
infra/_kit/bin/stack up
```

That last command:
- allocates ports for this `(project, worktree)` pair (deterministic — same worktree always gets the same ports)
- generates a compose override that maps those ports
- starts Docker Compose
- registers the instance in the dashboard
- runs the manifest-declared `post_up` lifecycle hooks (migrations, seeds, etc.)
- prints the URLs you can hit

Open the dashboard URL printed at the end and you'll see your stack listed.

---

## Make `stack` work from anywhere — the shell integration

The kit ships a shell function that auto-discovers `infra/_kit/bin/stack` in the current project, so you can just type `stack up` from any subdirectory of any stack-equipped repo. Same muscle memory across every project.

### Recommended — let the kit install it for you

```bash
infra/_kit/bin/stack install-shell
```

The command:
1. Copies `infra/_kit/shell-integration.sh` to **`~/.stack/shell-integration.sh`** (stable path; survives project deletion).
2. **Asks you** before touching `~/.zshrc` (or `~/.bashrc`). You see the exact line that will be appended; nothing happens without explicit `yes`.
3. Appends one line to the detected rc:
   ```bash
   [[ -f ~/.stack/shell-integration.sh ]] && source ~/.stack/shell-integration.sh
   ```
4. Reminds you to `source ~/.zshrc` (or open a new shell) to activate.

After that, `stack up`, `stack logs core`, `stack tls install`, etc. work from any subdirectory of any kit-equipped repo. The function walks up from `$PWD` looking for `infra/_kit/bin/stack` and invokes that project's CLI. cd into a different Stack project — `stack up` invokes THAT project's stack. Zero ambiguity.

### Manual install (if you prefer not to let the kit edit your rc)

```bash
# 1. Place the integration file at a stable path:
mkdir -p ~/.stack && cp infra/_kit/shell-integration.sh ~/.stack/

# 2. Add this single line to ~/.zshrc (or ~/.bashrc):
echo '[[ -f ~/.stack/shell-integration.sh ]] && source ~/.stack/shell-integration.sh' >> ~/.zshrc

# 3. Reload your shell:
source ~/.zshrc
```

### Alternatives — if you don't want shell integration

```bash
# Per-project alias (works only when cwd is the repo root):
alias stack='infra/_kit/bin/stack'

# Or as a package.json script (works from repo root, pays pnpm tax per call):
# "scripts": { "stack": "infra/_kit/bin/stack" }
```

---

## What the kit will NEVER do without asking you

The agent and every kit command treats **local machine config files** as user property. The kit declares intent and waits for `yes` before:

- Editing `~/.zshrc`, `~/.bashrc`, `~/.profile`, or other shell rc files.
- Writing to `~/.config/*`, `~/Library/LaunchAgents/`, `~/Library/Application Support/*`, `~/.ssh/config`, or any other dotfile under `$HOME`.
- Editing `/etc/hosts` or any other system file.
- Adding to the system keychain or trust stores (the mkcert CA install is run by **you**, not the kit — `mkcert -install`).
- Installing a launchd plist or systemd user unit (`stack dashboard install` exists but always confirms first).

The kit writes freely to:
- `~/.stack/` (its own state dir)
- Files inside the project tree (`infra/.ports`, `infra/.compose.override.yml`, `infra/certs/` — all gitignored)

Anything outside those = explicit confirmation, always.

---

## The commands you'll actually use

```
stack help                    show every command + flag
stack doctor                  is my environment sane?
stack up                      boot the stack
stack down                    stop it (DB volume preserved)
stack reset                   stop + wipe DB (asks for confirmation)
stack ps                      what's running for this worktree
stack ports                   show port assignments for this worktree
stack logs                    tail the app logs (always with timestamps)
stack logs <svc> --since 10m  tail one service for the last 10 minutes
stack psql                    interactive psql against the local DB
stack psql -c "SELECT 1"      one-shot SQL
stack exec <cmd>              run a command inside the app container
stack seed list               available scenario seeds
stack seed apply <name>       apply a scenario
stack tls install             generate / refresh local TLS cert (mkcert)
stack tls status              show cert path + expiry
stack lifecycle list          show post_up / pre_down hooks declared in manifest.yaml
stack lifecycle run <phase>   run one phase ad-hoc
stack up --no-hooks           skip the post_up bootstrap chain (advanced)
stack dashboard               open the cross-project dashboard
stack tunnel                  expose locally (ngrok) for webhook testing
stack triage prod             remote production health check
```

`stack help` shows the full list. The handful above covers 95% of daily use.

---

## Working HTTPS locally (`https://<slug>.loc`)

The kit ships proper HTTPS for local dev — no "your connection is not private" warning, no clicking through. Powered by [mkcert](https://github.com/FiloSottile/mkcert).

```bash
# One time per machine (works on macOS, Linux, Windows, WSL):
brew install mkcert nss        # macOS — see infra/_kit/TLS.md for other OSes
mkcert -install                # creates a local CA and registers it in your trust stores

# One time per project:
stack tls install              # generates infra/certs/<slug>.{pem,-key.pem} signed by your local CA
                               # reloads caddy automatically
```

After that, `https://your-app.loc` (or whatever your project's `domain_dev` is) loads cleanly in every browser with a green padlock. The cert is valid for ~2 years; `stack tls renew` regenerates. `stack doctor` warns when expiry is near.

**For the full background — what a CA is, why mkcert vs. alternatives, cross-platform install, troubleshooting** — read [`TLS.md`](TLS.md). It's the canonical reference.

---

## Running without the kit — manual mode

The `stack` CLI is a thin wrapper around `docker compose`. If the kit is broken, not yet installed, or you're learning what's happening under the hood, every `stack` subcommand has a literal `docker compose` equivalent.

### The two anchor values you need

Every manual invocation needs the same two flags:

| Flag | Value | How to find it |
|---|---|---|
| `-f <compose-file>` | Which compose file to read | `manifest.yaml` → `compose.<profile>`. For Demoapp default profile: `infra/docker-compose.dev.yml` |
| `-p <project-name>` | Compose project namespace | `<slug>_<worktree-branch>`. For Demoapp on `main`: `demoapp_main`. Computed from `manifest.yaml.project.slug` + `git symbolic-ref --short HEAD` (slashes → dashes). |

**Why the project name matters:** without `-p`, docker compose derives the project name from the directory you run from (typically `infra` for these files), which collides across worktrees and breaks the kit's namespacing. **Always pass `-p`.**

### Tip — set the two variables once per shell

To avoid re-typing the flags on every command, export them in your terminal:

```bash
cd ~/code/demoapp
export COMPOSE_FILE=infra/docker-compose.dev.yml
export COMPOSE_PROJECT_NAME=demoapp_main
```

Now you can drop `-f` and `-p` entirely:

```bash
docker compose up -d --build
docker compose down
docker compose logs core -f --timestamps
```

These two env vars are honoured by `docker compose` natively. They live in your shell session only — closing the terminal forgets them. The kit doesn't depend on them.

### Cheatsheet — kit command → manual equivalent

Run all from the **repo root** (e.g. `~/code/demoapp`). The cheatsheet assumes `COMPOSE_FILE` + `COMPOSE_PROJECT_NAME` are set per the tip above — otherwise prepend `-f infra/docker-compose.dev.yml -p demoapp_main` to each `docker compose` call.

| Goal | Kit | Manual |
|---|---|---|
| Boot the stack | `stack up` | `docker compose up -d --build` |
| Stop (keep DB) | `stack down` | `docker compose down` |
| Stop + drop DB | `stack down --volumes` | `docker compose down --volumes` |
| Show running services | `stack ps` | `docker compose ps` |
| Tail app logs | `stack logs core --follow` | `docker compose logs core -f --timestamps` |
| Logs since 10 min ago | `stack logs core --since 10m` | `docker compose logs core --since 10m --timestamps` |
| Open psql shell | `stack psql` | `docker compose exec postgres psql -U demoapp -d demoapp` |
| One-shot SQL | `stack psql -c "SELECT 1"` | `docker compose exec -T postgres psql -U demoapp -d demoapp -c "SELECT 1"` |
| Run command in app container | `stack exec npm ls` | `docker compose exec core npm ls` |
| Restart one service | `stack restart core` | `docker compose restart core` |
| Force-recreate one service | (auto on `stack tls install`) | `docker compose up -d --no-deps --force-recreate caddy` |

### Lifecycle hooks (the migrate + seed combo) — manual

`stack up` automatically runs the manifest's `lifecycle.post_up` hooks. To do it by hand:

```bash
# Apply schema migrations
docker compose exec -T -w /app/apps/core core npx drizzle-kit migrate

# Reconcile projects from infra/projects.dev.yaml
docker compose exec -T -w /app/apps/core -e APP_ENV=development core \
  node scripts/seed-projects.bundle.cjs
```

The flags:
- `-T` — no TTY (run non-interactively, suitable for scripts)
- `-w /app/apps/core` — set working directory inside the container (matches the manifest's `workdir`)
- `-e APP_ENV=development` — set an env var for this command only (matches the manifest's `env`)
- `core` — the service name (from `manifest.yaml.services.app`)

To see the full list of hooks declared in the manifest without running them:

```bash
# Without the kit:
grep -A 30 'lifecycle:' infra/_kit/manifest.yaml

# With the kit:
stack lifecycle list
```

### TLS — manual

`stack tls install` does this:

```bash
# 1. Generate cert (requires mkcert installed; mkcert -install run once per machine)
mkdir -p infra/certs
cd infra/certs
mkcert -cert-file your-app.loc.pem -key-file your-app.loc-key.pem \
  your-app.loc "*.your-app.loc" localhost 127.0.0.1 ::1
cd -

# 2. Force-recreate caddy to pick up the new cert + Caddyfile
docker compose up -d --no-deps --force-recreate caddy

# 3. Verify (without -k — proves the system trust store accepts the cert)
curl -s -o /dev/null -w "HTTP %{http_code} · ssl_verify=%{ssl_verify_result}\n" \
  https://your-app.loc/api/health
# Expected: HTTP 200 · ssl_verify=0
```

### Production triage (VPS) — manual

The kit's `stack triage prod` is SSH + `docker compose` against the production host. Manual equivalents:

```bash
# Set this once per shell to avoid retyping
export VPS=deploy@<host>   # from infra/ansible/inventory.yml

# Status
ssh $VPS "cd /opt/demoapp && docker compose ps"

# Logs
ssh $VPS "cd /opt/demoapp && docker compose logs core --since 10m --timestamps"

# Health
curl https://your-app.example.com/api/health

# Disk
ssh $VPS "df -h /var/lib/docker /opt/demoapp && docker system df"

# Open a psql tunnel (then connect with any local psql)
ssh -L 5499:127.0.0.1:5432 $VPS
# in another terminal:
psql "postgres://demoapp:<pwd>@localhost:5499/demoapp"   # password from ansible-vault
```

### Manifest values — where every variable comes from

When the cheatsheet says e.g. `psql -U demoapp -d demoapp`, those literals come from the manifest. Map:

| Manual literal | Manifest key | Demoapp value |
|---|---|---|
| Compose file path | `compose.full` (or `.minimal` / `.prod`) | `infra/docker-compose.dev.yml` |
| Compose project name | `<project.slug>_<git branch>` | `demoapp_main` |
| App container service name | `services.app` | `core` |
| DB container service name | `services.db` | `postgres` |
| Proxy container service name | `services.proxy` | `caddy` |
| DB user | `db.user` | `demoapp` |
| DB name | `db.database` | `demoapp` |
| DB default password (dev only) | `db.default_password` | `demoapp` |
| App's workspace path | `project.app` | `apps/core` |
| Dev hostname | `project.domain_dev` | `your-app.loc` |
| Prod hostname | `project.domain_prod` | `your-app.example.com` |
| VPS SSH user | `vps.user` | `deploy` |
| VPS app path | `vps.app_path` | `/opt/demoapp` |

Open `infra/_kit/manifest.yaml` to see them all.

### What you lose going manual

| Kit feature | What you give up |
|---|---|
| `<slug>_<worktree>` project name | Hand-pick names, easy to clash |
| Auto port allocation per worktree | Manual port juggling for parallel worktrees |
| `~/.stack/registry.json` tracking | No cross-project view of what's running |
| Dashboard at `:42137` | Same |
| `stack doctor` preflight | Diagnose by hand when something breaks |
| Lifecycle hooks running on every `up` | Have to remember migrate + seed every time |
| `stack tls install` mkcert flow | Run mkcert + edit Caddyfile + recreate caddy by hand |
| `stack triage prod` SSH playbook | Copy-paste from `sop/checking_production_logs.md` |
| Friendly errors with "what to try next" hints | Cryptic docker compose errors |

The kit's value isn't magic — it's *not having to remember which `-f -p -w -e -T` combo you need this morning*. But if the kit is broken or you're somewhere it isn't installed, the raw commands above are everything.

---

## Where things live

```
infra/
├── _kit/                       ← the kit itself
│   ├── OVERVIEW.md               ← what the kit is, owns / doesn't own, status
│   ├── USAGE.md                  ← you are here (operator how-to)
│   ├── AGENT.md                  ← the long-form agent reference / triage manual
│   ├── CONNECTIONS.md            ← what the kit requires, unlocks, who consumes it
│   ├── TLS.md                    ← HTTPS / mkcert deep dive
│   ├── GAPS_AND_ROADMAP.md       ← known-missing pieces and field notes
│   ├── manifest.yaml             ← your project's infra identity card
│   ├── bin/
│   │   ├── stack                 ← the CLI
│   │   └── stack-dashboard       ← the localhost:42137 tracker
│   ├── lib/                      ← bash helpers (ports, state, compose, doctor, seed, prod)
│   ├── seeds/                    ← scenario seed files (your project's, not the kit's)
│   └── templates/                ← used by /infra-bootstrap when porting to a new repo
│
├── docker-compose.dev.yml        ← your project's full local stack
├── docker-compose.yml            ← your project's minimal stack (DB-only)
├── docker-compose.vps.yml        ← your project's production stack (if VPS-deployed)
├── Dockerfile.<service>          ← your project's image builder
├── Caddyfile.dev / .prod         ← your project's reverse-proxy config
├── .env / .env.example           ← compose-time env vars
└── ansible/                      ← only if VPS-deployed

apps/<your-app>/
├── .env.local                    ← Next.js / scripts env (host-run path)
└── .env.local.example            ← template

.claude/
├── agents/infra.md         ← the agent definition
└── skills/infra*/                ← seven specialised skills

~/.stack/                         ← per-user state (cross-project)
├── registry.json                 ← what's running where
├── port-registry.json            ← persisted port assignments
├── seed-log.jsonl                ← every seed application
└── rotation-log.jsonl            ← every secret rotation you've done
```

The kit owns `infra/_kit/`. Your project owns the files at `infra/` directly.

---

## Multiple worktrees, no conflicts

Run `stack up` in three worktrees of the same project at once — no port collisions, no compose-project clashes, no volume mixing. Each `(project, worktree)` pair gets its own deterministic port range, persisted in `~/.stack/port-registry.json`.

Same worktree, tomorrow → same ports as today. Different branches → different ports, automatically. Foreign processes already using a port → the allocator probes forward until it finds a free one.

`stack ports` shows what your current worktree got.

---

## Sandboxes — ephemeral isolated stacks (the AI's workbench)

A **sandbox** is a fully-isolated copy of your stack — own containers, own DB, own network, own lifecycle — designed for testing, scenarios, and AI workflows. Multiple sandboxes can run in parallel without colliding with each other or with your primary stack. Each has a TTL (default 1h) and is auto-reaped on the next `stack` invocation.

### Key properties

- **Zero host ports.** Sandboxes never bind a host port. They live entirely inside docker networks. Accessing them goes through `stack sandbox <id> {exec|psql|logs|seed}` which routes via `docker compose exec`. Collision-free by construction.
- **Fast spawn.** Reuses the primary's already-built image. First sandbox after a `stack up` takes seconds, not minutes.
- **Independent state.** Each sandbox has its own DB volume. Seed it, mutate it, throw it away.
- **Auto-cleanup.** TTL-based GC runs lazily on every `stack` command. Default TTL is 1h; soft cap of 10 concurrent per project (configurable via `features.sandbox_max_concurrent` in the manifest).
- **Visible.** Sandboxes appear in the cross-project dashboard tagged 🧪 with their countdown to expiry.

### Building blocks (compose them as needed)

```bash
# Management
stack sandbox create [--name <label>] [--ttl 1h] [--no-hooks] [--quiet]
stack sandbox list                          # all sandboxes across all your projects
stack sandbox destroy <id> [<id>...]        # tear down one or more
stack sandbox destroy --all                 # tear down every sandbox for THIS project
stack sandbox gc                            # reap expired (runs lazily too)
stack sandbox inspect <id>                  # registry entry as JSON

# Scoped — instance ID is a context prefix for any existing stack subcommand
stack sandbox <id> ps
stack sandbox <id> exec <cmd>               # run a command inside the app container
stack sandbox <id> psql [args]              # one-shot or interactive psql
stack sandbox <id> logs [args]              # tail logs
stack sandbox <id> seed apply <name>        # apply a scenario seed
stack sandbox <id> seed list                # available scenarios in the project
stack sandbox <id> lifecycle run <phase>    # re-run manifest hooks against THIS sandbox
stack sandbox <id> inspect                  # same as `stack sandbox inspect <id>`
```

### Recipes — what an AI agent (or you) actually does with this

**Test a webhook handler in isolation:**

```bash
ID=$(stack sandbox create --name webhook-test --ttl 30m --quiet)

stack sandbox $ID seed apply 20-issue-labeled
stack sandbox $ID exec wget -qO- --post-data='{"action":"labeled",...}' \
  --header='X-GitHub-Event: issues' \
  --header='X-Hub-Signature-256: <sig>' \
  http://localhost:4100/api/webhooks/github

stack sandbox $ID psql -c "SELECT id, source, kind FROM signals ORDER BY created_at DESC LIMIT 5"
stack sandbox $ID logs core --since 30s | grep -i "demoapp\|error"
stack sandbox destroy $ID
```

**Spin up 3 sandboxes with different scenarios, run them in parallel:**

```bash
A=$(stack sandbox create --name happy-path     --quiet); stack sandbox $A seed apply 20-issue-labeled
B=$(stack sandbox create --name pr-exists      --quiet); stack sandbox $B seed apply 20-pr-already-open
C=$(stack sandbox create --name missing-label  --quiet); stack sandbox $C seed apply 20-no-demoapp-label

# … exercise each independently, in any order …

stack sandbox destroy $A $B $C
# or: stack sandbox destroy --all
```

**A sandbox without the bootstrap chain (testing migrations themselves):**

```bash
ID=$(stack sandbox create --no-hooks --quiet)
stack sandbox $ID exec sh -c "cd /app/apps/core && npx drizzle-kit migrate"   # run it manually
stack sandbox destroy $ID
```

**Inspect a long-running sandbox you forgot about:**

```bash
stack sandbox list
# →   demoapp-sandbox-a3f4d1   webhook-test   demoapp   2h 14m   EXPIRED   yes

stack sandbox gc   # cleans it up
# OR
stack sandbox destroy demoapp-sandbox-a3f4d1
```

### What the app image has (and doesn't)

The Demoapp app container is Alpine + Node. It includes `wget` (busybox), `sh`, `node`, `npx`, `git`, `claude-code`, `drizzle-kit`. It does **NOT** include `curl`. For HTTP from inside the container, use `wget -qO-` or `node -e 'fetch(...)'`. From outside, hit the sandbox via `stack sandbox <id> exec` and the relevant binary.

### What sandboxes don't do

- ❌ Don't expose host ports (intentional — collision-free isolation)
- ❌ Don't auto-pick up code changes (they snapshot the current image — for fresh code, `stack up --build` to rebuild the primary first, then create a sandbox to pick up the new image)
- ❌ Don't replace the primary stack. The primary is your interactive dev environment. Sandboxes are for parallel/throwaway/AI work.

---

## When things break

`stack` tells you what's wrong and what to do about it. The most common failures:

| Error | What it means | Fix |
|---|---|---|
| `docker daemon not running` | Docker Desktop isn't running | Start Docker Desktop and retry |
| `manifest.yaml missing` | Kit not installed in this repo | Ask the AI to run `/infra-bootstrap` |
| `infra/.env missing` | Env file not copied yet | `cp infra/.env.example infra/.env` and fill in values |
| `compose file not found: <path>` | Manifest references a file that doesn't exist | Check `infra/_kit/manifest.yaml` → `compose:` paths |
| `bind: address already in use` | Some other process owns a port the allocator chose | Ask the AI to run `/infra-port-doctor`, or stop the foreign process |
| `database container not running` | Stack isn't up | `stack up` first, then retry |
| `seed not found: <name>` | Scenario file doesn't exist | `stack seed list` to see available scenarios |
| `python3 missing` | Required for the manifest reader | Install Python 3 (preinstalled on macOS) |

`stack` always prints **what failed** and **what to try next**. If a message ever leaves you guessing, that's a bug in the kit — open an issue.

---

## Cross-project dashboard

Open **http://localhost:42137** (started automatically by `stack up`).

You'll see:
- Every project + worktree you have running on this machine
- Service ports, with green/red dots for live/dead
- Uptime per instance
- Quick URLs to click through

Endpoints if you want to script against it:

| URL | Returns |
|---|---|
| `GET /api/state` | Full state JSON |
| `GET /api/instances` | Just the instances |
| `GET /api/instances/:id` | One instance |
| `GET /api/health` | `{ok, instances, port}` |

To install as a launch-on-login service:

```bash
stack dashboard install        # launchd (macOS) or systemd user unit (Linux)
```

---

## Talking to the agent

Inside Claude Code, the `infra` agent owns all infrastructure work. Invoke it directly, or use one of the seven skills:

| Skill | When to use it |
|---|---|
| `/infra` | Anything not covered below — boot, log, query, restart, etc. |
| `/infra-seed` | Apply or author a scenario seed |
| `/infra-port-doctor` | Port conflicts, "address in use" errors |
| `/infra-rotate-secret` | **Guided walkthrough** for rotating a secret — the AI guides, you execute |
| `/infra-prod-triage` | Production triage on a VPS-deployed project |
| `/infra-cloud-triage` | Production triage on Vercel + Neon |
| `/infra-bootstrap` | Install the kit into a new project |
| `/infra-dashboard` | Start / focus / stop the dashboard |

The agent never runs destructive operations without asking. It declares "blast radius" before any non-trivial action and waits for your greenlight.

---

## What the agent will NOT do

By design, the agent **guides you** but does not execute these actions itself:

- **Secret rotation.** The `/infra-rotate-secret` skill walks you through the six phases (revoke → regenerate → store → deploy → verify → log). It tells you what to run; you run it; it confirms your output before advancing. The AI never executes `ansible-vault edit`, `ansible-playbook`, `vercel env add`, or provider-side revokes.

- **Git destructive ops.** `git reset --hard`, `git clean -fd`, `git push --force` — never without your explicit say-so.

- **Production database mutations.** Read-only by default; writes refused unless you set `STACK_PROD_MUTATE=1` and type the unlock phrase.

- **`docker system prune -a`, dropping pgdata, exposing Postgres to the internet.** Each of these needs an explicit unlock phrase. See the agent definition for the full list.

---

## Going deeper

| If you want… | Read |
|---|---|
| The full operations manual + decision log + glossary | [`AGENT.md`](AGENT.md) |
| What's planned, what's deferred, field notes | [`GAPS_AND_ROADMAP.md`](GAPS_AND_ROADMAP.md) |
| How to write a scenario seed | [`seeds/README.md`](seeds/README.md) |
| **TLS / HTTPS / mkcert — the complete guide** | [`TLS.md`](TLS.md) |
| First-time VPS provisioning (Hetzner + Ansible) | [`../ansible/README.md`](../ansible/README.md) (consumer-specific; only present on VPS-profile installs) |

---

## A note on Python

The kit needs `python3` (preinstalled on macOS, `apt install python3` on Linux). It uses **only the standard library** — no `pyyaml`, no `pip install` required. Same for the dashboard (no `npm install`).

If `stack doctor` complains about a missing tool, it's an actual missing tool — not a Python dependency.

---

## FAQ

**Q. Where does my dev DB live?**
In a Docker volume named after the compose project (e.g., `demoapp_main_pgdata`). Survives container restarts. Killed by `stack reset` or `stack down --volumes`.

**Q. How do I connect my GUI (DBeaver, TablePlus) to the local DB?**
Run `stack ports` to see the DB port. Connect to `localhost:<that port>`, user/db = your manifest's `db.user` / `db.database` (often the project slug), password = `db.default_password` (also often the slug for dev).

**Q. Can I run two projects at once?**
Yes. Different projects get different compose projects + different port ranges. The dashboard shows them all.

**Q. What if I close Docker Desktop with the stack running?**
The containers are gone. The registry still has the entry. `stack doctor` will flag it; `stack up` brings everything back at the same ports.

**Q. What if I delete a worktree without `stack down`?**
The registry has a stale entry. Ask the AI for `/infra-port-doctor gc` to clean it up.

**Q. Where do my secrets actually go in production?**
Depends on the project's profile: VPS → Ansible vault → `/opt/<app>/.env` (mode 0600). Cloud (Vercel) → Vercel env. The agent's `/infra-prod-triage` and `/infra-cloud-triage` skills know which.

**Q. The dashboard won't load.**
`stack dashboard status` to check. `stack dashboard restart` to recycle. `stack dashboard stop` to kill. The default port is `42137` (set in `~/.stack/config`); change `STACK_DASHBOARD_PORT` in that file to use a different one.

**Q. `https://<slug>.loc` shows a cert warning.**
Run `stack tls install`. Read [`TLS.md`](TLS.md) for the full background. Most likely cause is that mkcert hasn't been installed yet (`brew install mkcert nss && mkcert -install` on macOS).

**Q. `stack up` finishes but my app returns 500 for everything.**
The DB is up but uninitialised — schema migrations + seed data didn't run. Add the bootstrap recipe to `infra/_kit/manifest.yaml` → `lifecycle.post_up`. See [`AGENT.md`](AGENT.md) §5.8 "Lifecycle hooks". Once declared, every `stack up` (and every fresh worktree) auto-bootstraps.

---

Built to be boring. Built to feel the same in every project. If it doesn't, that's a bug — fix the kit, not your habits.
