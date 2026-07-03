# Infrastructure — The Agent Manual

A complete reproduction + triage manual for the infrastructure of every Nucleus-based project at your organization. Hand this file to an AI agent and it should be able to:

1. Reproduce the local + production setup from scratch.
2. Triage any production incident on a VPS-deployed or cloud-deployed (Vercel + Neon) project.
3. Rotate secrets safely.
4. Spin up ephemeral environments for AI testing.
5. Add new env vars, new services, new projects to the manifest.
6. Identify and act on gaps.

The manual is the long-form counterpart to the agent definition at [`.claude/agents/infra.md`](../../.claude/agents/infra.md). Read both.

---

## 1. The mental model

### 1.1 The three-layer cake

Every Nucleus project's infrastructure has the same three layers:

```
┌────────────────────────────────────────────────────────────────┐
│  LAYER 3 — Code & data delivery                                │
│    Code  pipeline: git push → CI → image → /opt/<app> (or Vercel) │
│    Data  pipeline: vault edit → Ansible → /opt/<app>/.env         │
│    Migrations: drizzle-kit (or equivalent) — runs on every deploy │
└────────────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────────┐
│  LAYER 2 — Runtime topology                                    │
│    Caddy ↔ App ↔ Postgres   (VPS)                               │
│    Vercel ↔ Neon            (cloud)                             │
│    Caddy ↔ App ↔ Vercel + Neon worker   (hybrid)                │
└────────────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────────┐
│  LAYER 1 — Operator surface                                    │
│    Nucleus Stack Kit — uniform CLI (`stack`) across all projects │
│    Cross-project dashboard at http://localhost:42137            │
│    8 skills + 1 agent (`infra`)                          │
└────────────────────────────────────────────────────────────────┘
```

The kit (Layer 1) is the operator surface. It wraps Layers 2 and 3 so that **every project feels the same** to a human or an AI.

### 1.2 The single-VPS shape (default for self-hosted)

```
                              Internet
                                  │
                                  ▼  443/80
                  ┌───────────────────────────────┐
                  │  Caddy (caddy_data: TLS certs)│
                  │  your-app.example.com → core:4100│
                  └───────────────┬───────────────┘
                                  │  internal docker network
                                  ▼
                  ┌───────────────────────────────┐
                  │  Core (Next.js, :4100)         │
                  │  reads /opt/<app>/.env (0600)  │
                  └───────────────┬───────────────┘
                                  │  postgres:5432
                                  ▼
                  ┌───────────────────────────────┐
                  │  Postgres (pgvector, :5432)    │
                  │  bound to 127.0.0.1 only       │
                  │  pgdata volume                 │
                  └───────────────────────────────┘
```

- **Three containers, one VPS.** Coordinated by `docker compose -f /opt/<app>/docker-compose.yml`.
- **One env file.** `/opt/<app>/.env` (mode 0600), rendered from the encrypted vault.
- **Two volumes.** `pgdata` (DB), `caddy_data` (TLS certs). Backups are project-specific.
- **No Postgres on the public internet.** Loopback bind only. Remote access is via SSH tunnel.

### 1.3 The cloud shape (Vercel + Neon)

```
                              Internet
                                  │
                                  ▼  443
                  ┌───────────────────────────────┐
                  │  Vercel edge (HTTPS, CDN)      │
                  │  routes to serverless functions│
                  └───────────────┬───────────────┘
                                  │  HTTPS over Vercel network
                                  ▼
                  ┌───────────────────────────────┐
                  │  Neon Postgres (pooled or direct)│
                  │  one branch per env             │
                  │  autosuspend on idle           │
                  └───────────────────────────────┘
```

- **No long-running container, no Caddy.** Vercel's edge network terminates TLS and routes per-request.
- **Env lives in Vercel.** Per environment (production / preview / development) with a separate secret per scope.
- **Branches as ephemeral envs.** Each PR gets a Neon branch (copy-on-write). Merge → branch destroyed.
- **Cold starts.** Endpoints idle → Neon endpoint suspended. First request after idle costs ~500ms.

---

## 2. The two pipelines (VPS profile)

Code and secrets are deployed via independent pipelines. **They never cross.**

### 2.1 The code pipeline

```
git push main
   │
   ▼
.github/workflows/deploy.yml on ubuntu-latest
   │
   ├─ checkout repo
   ├─ docker login ghcr.io with secrets.GITHUB_TOKEN
   ├─ docker build with infra/Dockerfile.<app>
   ├─ docker push ghcr.io/<org>/<app>/<service>:latest + :<sha>
   ├─ scp infra/docker-compose.vps.yml + infra/Caddyfile.prod → /opt/<app>
   ├─ ssh deploy@<host> "cd /opt/<app> && docker compose pull <app> && docker compose up -d"
   ├─ ssh deploy@<host> "drizzle-kit migrate" (in-container)
   └─ ssh deploy@<host> "seed-projects.bundle.cjs" (if the project has a manifest)
```

**What CI sees:** `GITHUB_TOKEN` (auto), `VPS_SSH_KEY`, `VPS_HOST`. Nothing else. Application secrets never enter CI.

**Rollback:** edit `/opt/<app>/docker-compose.yml` and change `core:latest` to `core:<sha>` then `docker compose pull core && docker compose up -d core`. Or: `git revert <commit> && git push` to drive the same image change through CI.

### 2.2 The secrets pipeline

```
ansible-vault edit infra/ansible/group_vars/all/vault.yml
   │  (you type the vault passphrase)
   ▼
ansible-playbook infra/ansible/provision.yml --ask-vault-pass -e ansible_user=deploy
   │
   ├─ Role `base`     — deploy user, sudo, SSH key, root login off, password auth off, 2GB swap
   ├─ Role `docker`   — Docker CE + Compose v2 from Docker's APT repo
   ├─ Role `firewall` — UFW deny inbound, allow 22/80/443
   ├─ Role `security` — fail2ban (SSH jail), unattended-upgrades
   └─ Role `<app>`    — application setup:
         ├─ mkdir /opt/<app>, chown deploy
         ├─ render env.j2 → /opt/<app>/.env (mode 0600)
         ├─ copy docker-compose.vps.yml → /opt/<app>/docker-compose.yml
         ├─ copy Caddyfile.prod → /opt/<app>/Caddyfile.prod
         ├─ docker login ghcr.io with vault_ghcr_token
         └─ docker compose up -d --pull always (recreates containers if env changed)
```

**What the vault holds:** AES-256 at rest in the repo. Decrypts only with the vault passphrase (lives on your laptop or in a secure backup). Plaintext only exists in two places: (a) inside `ansible-vault edit`'s ephemeral editor session, and (b) at `/opt/<app>/.env` (0600) on the VPS.

**The escaping rules in `env.j2`:**

| Value can contain | Filter to add |
|---|---|
| literal `$` | `\| replace('$', '$$')` (docker-compose halves it back) |
| literal newlines (e.g., PEM keys) | `\| replace('\n', '\\n')` |
| nothing special | no filter needed |

If you forget the `$$` doubling, compose treats `$` as the start of a variable and breaks signature verification at runtime. If you forget the `\n` escaping for a PEM, the env file has literal newlines which break parsing. Both are silent failures that show up only when the system actually tries to use the value.

---

## 3. The operator surface (Layer 1) — Nucleus Stack Kit

The kit lives at `infra/_kit/`. Read `infra/_kit/OVERVIEW.md` for what the kit owns and `infra/_kit/USAGE.md` for the file map and operator commands.

### 3.0 Making `stack` available everywhere — the shell integration

`stack` is a bash script inside each project at `infra/_kit/bin/stack`. It can't be globally installed (its `lib/` siblings are relative to its location). The kit's solution: a shell function at `~/.stack/shell-integration.sh` that walks up from `$PWD` looking for `infra/_kit/bin/stack` and invokes whichever one it finds.

**Install** (asks before touching your rc — see Commandment Three in the agent):

```bash
infra/_kit/bin/stack install-shell
```

What it does:
1. Copies `infra/_kit/shell-integration.sh` → `~/.stack/shell-integration.sh` (stable path, survives project deletion).
2. **Asks before editing rc.** Shows the exact line + the exact rc file. Waits for `yes`.
3. If approved: appends to `~/.zshrc` (or detected shell rc):
   ```bash
   # Nucleus Stack Kit shell integration
   [[ -f ~/.stack/shell-integration.sh ]] && source ~/.stack/shell-integration.sh
   ```
4. Reminds you to `source ~/.zshrc` or open a new shell.

After that, `stack <subcommand>` works from any subdirectory of any kit-equipped repo. Switch projects with `cd`, and `stack` automatically picks up that project's kit.

The function also enables zsh tab completion for subcommands (best-effort; loads only under zsh).

### 3.1 The single CLI

```
infra/_kit/bin/stack <command> [args]
```

| Subcommand | Purpose |
|---|---|
| `up [--profile <P>] [--seed <S>]` | Boot the local stack (primary; for sandboxes use `stack sandbox create`) |
| `down [--volumes] [--release-ports]` | Stop the local stack |
| `restart [<service>]` | Restart a service in place |
| `reset` | Stop + drop volumes (requires `"yes drop the database"`) |
| `ps` / `ports` / `doctor` | Inspection |
| `logs [<service>] [--follow] [--since 10m]` | Tail logs with timestamps |
| `psql [<sql>]` | Open psql or run one-shot SQL |
| `exec <cmd>` | Run a command inside the app container |
| `seed list / apply / inspect / new / reset` | Scenario runner |
| `dashboard [start|stop|status|json]` | Cross-project tracker |
| `tunnel [ngrok|cloudflared|portless]` | Webhook ingress for local |
| `triage prod [ps|logs|psql|tunnel|health|disk|deploy]` | VPS production triage |
| `triage cloud` | Cloud triage stub (full triage via `/infra-cloud-triage` skill) |

### 3.2 Port allocation — how it works

Every `(project_slug, worktree_branch)` pair gets its own port range, persisted in `~/.stack/port-registry.json`.

```
key = "<slug>@<worktree>"   e.g.  "demoapp@main", "demoapp@fix-ui"
```

For each of the four service roles (app, db, proxy_http, proxy_https):

```
hash = sha256("<key>:<role>")
base_port = <role_base> + (first_8_hex_of_hash % <role_range>)
chosen = first free port from base_port (linear probe forward), where "free" means:
   - no LISTEN socket per `lsof -i :<port>`
   - no other allocation in our registry on this port
```

Result:
- **Same worktree always gets the same ports.** Re-running `stack up` is idempotent.
- **Different worktrees of the same project never collide.** Even on the same machine, simultaneously.
- **Foreign processes are routed around.** A stray `node` on 4123 makes the kit pick 4124.
- **The allocation persists.** Stop the stack, come back tomorrow, `stack up` reuses the same ports.

On `stack up`, the chosen ports are also written to `infra/.ports` (gitignored) so they're inspectable:

```sh
$ cat infra/.ports
# Generated by Nucleus Stack Kit — do not edit by hand.
# Worktree: demoapp@main
STACK_KEY=demoapp@main
STACK_PORT_APP=4123
STACK_PORT_DB=5567
STACK_PORT_PROXY_HTTPS=9234
STACK_PORT_PROXY_HTTP=8234
```

### 3.3 Sandboxes — the AI's workbench

For ad-hoc, isolated, short-lived stacks (testing scenarios, running parallel variants, AI workflows), use `stack sandbox` — **not** `stack up`. The primary stack is the human's interactive dev environment; sandboxes are everything else.

```bash
ID=$(stack sandbox create --name webhook-test --ttl 30m --quiet)
stack sandbox $ID seed apply 20-issue-labeled
stack sandbox $ID exec wget -qO- http://localhost:4100/api/health
stack sandbox $ID psql -c "SELECT count(*) FROM signals"
stack sandbox destroy $ID
```

Full sandbox documentation: see §5.7 below.

> Historical: an earlier `stack up --ephemeral` flag was superseded by `stack sandbox`. The flag now prints a deprecation error pointing at `stack sandbox create`.

### 3.4 The dashboard

`http://localhost:42137` is the canonical view of "what's running on this machine right now." Single-file Node script, zero npm deps.

| Endpoint | Returns |
|---|---|
| `GET /` | HTML view (auto-refreshes every 5s) |
| `GET /api/state` | Full state JSON (registry + live port probes) |
| `GET /api/instances` | Just the instances array |
| `GET /api/instances/:id` | One instance |
| `GET /api/health` | `{ok, instances, port}` |
| `POST /api/refresh` | Forces a probe refresh (3s cache otherwise) |

The dashboard is read-only by design. To change state, you `stack` something.

`stack up` auto-starts the dashboard if `features.dashboard_auto_start: true` in the manifest (default). Otherwise, `stack dashboard` starts it on demand.

---

## 4. Topology by deploy profile

### 4.1 VPS profile (Demoapp is the canonical example)

Files in the project:

```
infra/
├── docker-compose.yml          # minimal: Postgres only (for `pnpm dev` outside Docker)
├── docker-compose.dev.yml      # full: app + db + proxy, builds from Dockerfile
├── docker-compose.vps.yml      # production: app + db + proxy, pulls image from GHCR
├── Dockerfile.<app>            # multi-stage: deps → build → runtime
├── Caddyfile.dev               # local: <slug>.loc, self-signed
├── Caddyfile.prod              # production: <domain>, Let's Encrypt
├── .env.example                # template for infra/.env (compose interpolation)
├── tunnel.sh                   # ngrok shortcut for webhook testing
├── ansible/                    # vault + provisioning
└── projects.{dev,prod}.yaml    # (optional) data manifest for the project
.github/workflows/deploy.yml    # the code pipeline
```

Inside the running prod container: `WORKDIR=/app/apps/<app>`, `process.cwd()=/app/apps/<app>`, hoisted `node_modules` at `/app/node_modules`, `next start` runs via `../../node_modules/.bin/next`.

The Dockerfile.* pattern:
- **Stage 1 (deps):** `pnpm install --frozen-lockfile`. `.npmrc` references `GITHUB_TOKEN`; pass `GITHUB_TOKEN=dummy` if no private packages authenticate, to keep pnpm from silently discarding the `.npmrc` (consult your project's memory notes for the documented `.npmrc` token trap).
- **Stage 2 (builder):** runs the project build (e.g., `pnpm --filter <pkg> build`), and bundles any "deploy-time scripts" (e.g., seed-projects) into a single CJS file with `esbuild` so the runtime stage doesn't need pnpm/tsx.
- **Stage 3 (runtime):** Alpine base. Globally installs the CLI tools the running container needs (e.g., `claude-code`, `drizzle-kit`, `drizzle-orm`, `pg`, `git`). Copies the built workspace + brain modes (or equivalent runtime-loaded config) + drizzle migrations + the bundled deploy scripts.

The Caddyfile is intentionally minimal:

```
your-app.example.com {
    reverse_proxy core:4100
}
```

Let's Encrypt is automatic. The `caddy_data` volume persists the cert.

### 4.2 Cloud profile (Vercel + Neon)

Files in the project:

```
infra/
├── docker-compose.yml          # local: just Postgres for offline testing
├── .env.example                # template for the local .env
├── neon-branches.md            # documents the branch convention
└── _kit/                     # kit (same as VPS)
.vercel/project.json            # `vercel link` output (gitignored)
.github/workflows/preview.yml   # preview deploy aware: lint, test, create Neon branch
```

The deploy is handled by Vercel itself — push to main → Vercel builds and deploys. Preview deployments per PR. No GitHub Actions workflow needed for deploy (only for tests and PR comments).

Env management:
- Production env in Vercel project settings (`vercel env ls production`).
- Preview env in Vercel project settings (`vercel env ls preview`).
- Local env in `apps/<app>/.env.local` (gitignored).

Webhooks: only the production deployment receives them (single URL constraint from providers). For local testing, use the kit's `stack tunnel` against `localhost:<STACK_PORT_APP>`.

### 4.3 Hybrid profile

A Vercel-deployed surface (Next.js app) + a VPS-deployed microservice (background worker, websocket server, AI orchestrator). The kit installs both stacks side-by-side.

Triage routes by service:
- "API returning 500" → `/infra-cloud-triage` (Vercel)
- "Worker not picking up tasks" → `/infra-prod-triage` (VPS)

Right now no project uses this shape. When one does, the kit's bootstrap will need to be extended (see `GAPS_AND_ROADMAP.md` G4).

---

## 5. Operational playbooks

These are the scripts the agent walks when a specific kind of work shows up.

### 5.1 First-time provisioning (VPS profile)

```bash
# A. Provision the VPS
brew install ansible
cd infra/ansible
cp inventory.yml.example inventory.yml          # add VPS IP
cp group_vars/all/vars.yml.example group_vars/all/vars.yml  # add your SSH public key
cp group_vars/all/vault.yml.example group_vars/all/vault.yml
ansible-vault encrypt group_vars/all/vault.yml  # then edit with the real values
ansible-playbook provision.yml --ask-vault-pass

# B. Point DNS
#    A record: <domain> → VPS IP

# C. Verify
curl https://<domain>/api/health
# Expected: {"status":"ok",...}

# D. (Optional) save the vault passphrase
echo 'pass' > infra/ansible/.vault_pass; chmod 600 infra/ansible/.vault_pass
```

The full first-time walkthrough — creating the GitHub Apps, Slack Apps, registering webhooks — is documented in `infra/ansible/README.md`. Read that file before running the playbook the first time.

### 5.2 Adding a new env var (full walkthrough)

The path from "I need `MY_NEW_VAR` in code" to "the running prod container sees it":

```
1. Code: const v = process.env.MY_NEW_VAR
2. Dev env (compose):    add `MY_NEW_VAR=value`  → infra/.env
3. Dev env (example):    add `MY_NEW_VAR=`       → infra/.env.example
4. Dev passthrough:      add `MY_NEW_VAR: ${MY_NEW_VAR:-}` to compose dev's environment:
5. Host dev env (Next):  add `MY_NEW_VAR=value`  → apps/<app>/.env.local
6. Host dev env (ex):    add `MY_NEW_VAR=`       → apps/<app>/.env.local.example
7. Prod passthrough:     add `MY_NEW_VAR: ${MY_NEW_VAR:-}` to compose vps's environment:
8. Prod template:        add `MY_NEW_VAR={{ vault_my_new_var }}` to env.j2
9. Vault:                ansible-vault edit → vault_my_new_var: "value"
10. Vault example:       add `vault_my_new_var: ""` to vault.yml.example
11. Deploy secret:       ansible-playbook provision.yml --ask-vault-pass
12. Deploy code:         git push origin main
13. Verify:              docker compose exec core printenv MY_NEW_VAR
```

10 files in 3 places (dev compose + host dev + prod). The agent's mental model: every var has up to 4 lives — local-compose, local-host, prod-template, prod-vault. Some vars only need a subset.

Common mistakes (from the SOP):
- Edited `vault.yml` only — value never reaches the container because env.j2 + compose passthrough are missing.
- Edited `env.j2` but not the compose file — value lands in `/opt/<app>/.env` but compose doesn't pass it in.
- Edited `apps/<app>/.env.local` but kept running the docker stack — dockerized app reads `infra/.env`, not `.env.local`.
- Forgot to restart — Next.js reads env once on boot.

### 5.3 Rotating a secret (see `/infra-rotate-secret`)

Six phases: **REVOKE → REGENERATE → STORE → DEPLOY → VERIFY → LOG**. Skip any one and you have a half-rotated secret, which is worse than a known-compromised one. The skill walks all six explicitly.

### 5.4 Production triage (VPS — four sources of truth)

```
1. Provider Recent Deliveries  (GitHub/Slack/Stripe UI)
2. Caddy access log            (docker compose logs caddy)
3. Core stdout                 (docker compose logs core --timestamps)
4. The relevant table          (psql via docker compose exec or SSH tunnel)
```

You walk these in order. Always. If the failure is visible at step 1, don't run steps 2-4. If step 1 says success but the user reports nothing happened, walk all the way to step 4.

Common failure modes and the diagnostic that exposes them:

| Symptom | Most likely cause | Diagnostic |
|---|---|---|
| Webhook 401 | Secret mismatch between container and provider | `docker compose exec core printenv <SECRET>` vs provider value |
| Webhook timeout | Container down or Caddy not routing | `docker compose ps`, then Caddy logs |
| Container restart loop | Missing required env var | `docker compose logs core` |
| 502 from Caddy | Core container down | `docker compose ps`, then `docker compose logs core --since 10m` |
| TLS cert expired | LE renewal failed silently | `docker compose logs caddy | grep -i cert` |
| Disk filling | Build cache | `docker system df`, then `docker container prune -f && docker image prune -f` |
| Slow responses | DB slow OR external API timeout | `docker compose logs core | grep -i timeout`, plus DB slow-query log |

### 5.5 Production triage (Cloud — four sources of truth)

```
1. Provider Recent Deliveries
2. Vercel deployment + function logs   (vercel logs <url> --since 1h)
3. Vercel env panel                    (vercel env ls production)
4. Neon branch DB                      (psql via neonctl connection-string)
```

Same shape. Different tools.

### 5.6 Adding a new project to a multi-tenant kit (Demoapp's `projects` table)

For projects like Demoapp that maintain an in-DB list of "projects we manage," the kit pattern is:

1. Edit `infra/projects.<env>.yaml` to add the new entry.
2. Commit + push.
3. On the next CI deploy, `seed-projects.bundle.cjs` reconciles the table — adds new, archives removed.

If you need to add a project _before_ the next deploy:

```bash
# Local dev:
psql "$DATABASE_URL" -c "
INSERT INTO projects (slug, name, clone_url, default_branch, status)
VALUES ('owner/repo', 'Repo', 'https://github.com/owner/repo.git', 'main', 'active');
"

# Production (one-shot via SSH):
ssh deploy@<host> "cd /opt/<app> && docker compose exec -T postgres psql -U <user> -d <db> -c \"
INSERT INTO projects (slug, name, clone_url, default_branch, status)
VALUES ('owner/repo', 'Repo', 'https://github.com/owner/repo.git', 'main', 'active');
\""
```

Always commit the YAML change too, otherwise the next playbook run won't archive correctly.

---

### 5.7 Sandboxes — ephemeral isolated stacks

A **sandbox** is an isolated copy of the project's stack used for testing, parallel scenario exploration, and AI workflows. Multiple sandboxes can run simultaneously without colliding with each other or with the primary stack.

**Design constraints honoured:**

1. **No host ports.** Sandboxes set `ports: []` (via a per-instance compose override at `~/.stack/run/sandbox-<id>.compose.yml`) for every service. They live entirely inside docker networks. Access is exclusively via `docker compose exec`, surfaced as `stack sandbox <id> {exec|psql|logs|seed|lifecycle}`. **No port allocation needed** for sandboxes — the allocator/registry is primary-stack-only.

2. **Reuse primary build.** On create, the kit detects the primary's image (`<slug>_<worktree>-<service>`, e.g. `demoapp_main-core`) and tags it under the sandbox's compose-project name. Compose then runs without `--build`. First sandbox after a `stack up` takes seconds.

3. **TTL + GC.** Each sandbox carries a TTL (default 1h, configurable per call). On every `stack` invocation, `stack_sandbox_gc` runs lazily — destroying any sandbox past its `expires_at`. Cheap (just compares timestamps in JSON).

4. **Concurrent cap.** Soft cap of 10 active sandboxes per project, configurable via `features.sandbox_max_concurrent`. `create` refuses past the cap with a hint.

5. **Shared registry.** Sandboxes register in the same `~/.stack/registry.json` the dashboard reads, with `kind: "sandbox"`, `ephemeral: true`, `expires_at`, and `ttl_seconds`. Dashboard tags them 🧪 automatically.

**Identifiers:**
- User-facing ID: `<slug>-sandbox-<6-char-hex>` (e.g., `demoapp-sandbox-a3f4d1`).
- Compose project name: `<slug>_sandbox_<6-char-hex>` — same chars, underscores instead of dashes.
- Override file: `~/.stack/run/sandbox-<id>.compose.yml`.

**Building blocks (no opinionated workflow):**

| Verb | Effect |
|---|---|
| `stack sandbox create [--name X] [--ttl 1h] [--no-hooks] [--quiet]` | Spawn isolated instance. Returns ID on stdout (quiet mode) or JSON (default). Runs `lifecycle.post_up` hooks unless `--no-hooks`. |
| `stack sandbox list` | Tabular list of all active sandboxes (across projects) with age, expiry countdown, hooks-applied state. |
| `stack sandbox destroy <id> [<id>...] \| --all` | Tear down one, multiple, or all-for-this-project. |
| `stack sandbox gc` | Reap any past TTL (also auto-runs lazily). |
| `stack sandbox inspect <id>` | Registry entry as JSON. |
| `stack sandbox <id> <subcommand>` | Run any normal `stack` subcommand scoped to that sandbox (ps/psql/exec/logs/seed/lifecycle/inspect). |

**Context routing (how scoped subcommands work):**

`stack sandbox <id> psql ...` sets `STACK_COMPOSE_PROJECT_OVERRIDE` (which `stack_compose_project_name` honors) and `STACK_COMPOSE_EXTRA_FILES` (which `stack_compose` adds as `-f` flags), then dispatches to the regular `cmd_psql`. Every existing helper Just Works scoped to the sandbox. No code duplication.

**Why no opinionated AI workflow:**

The kit ships building blocks, not a "spawn-seed-run-collect-teardown" wrapper. AI agents can compose them freely — e.g., spin up 3 sandboxes with different seeds, run them in parallel, destroy all 3 at the end. Or spawn one, mutate state, capture the DB into a snapshot, mutate more, snapshot again. The kit doesn't presume the workflow.

The agent's `infra.md` documents sandboxes as **the AI's primary workbench** — the primary stack is the human's interactive dev environment; sandboxes are for parallel/throwaway/scenario work.

**Logged state:**

`~/.stack/registry.json` — single source of truth, includes sandbox entries with `kind: "sandbox"`, used by both `stack sandbox list` and the dashboard.

---

### 5.8 Lifecycle hooks — `stack up` bootstraps the data layer

Every project declares its bootstrap recipe in `infra/_kit/manifest.yaml` under `lifecycle.post_up:`. The kit runs each declared step automatically after the stack is healthy, before printing the final "Up" summary. The kit ships zero opinions about WHAT bootstraps — that's the project's call.

For Demoapp:

```yaml
lifecycle:
  post_up:
    migrate:
      description: Apply drizzle schema migrations
      exec: npx drizzle-kit migrate
      workdir: /app/apps/core
    seed_projects:
      description: Reconcile projects.dev.yaml into the projects table
      exec: node scripts/seed-projects.bundle.cjs
      workdir: /app/apps/core
      env: APP_ENV=development
  pre_down: {}
```

**Schema per hook step:**

| Field | Required | Purpose |
|---|---|---|
| `exec:` | yes | The command. Runs in the app container via `docker compose exec -T <app> sh -c "<cmd>"` — full shell semantics. |
| `workdir:` | no | Optional path. Translates to `docker compose exec -w <path>`. Defaults to the container's WORKDIR. |
| `env:` | no | Optional space-separated `KEY=VAL` pairs. Each becomes `-e KEY=VAL`. |
| `on_failure:` | no | `abort` (default) — stop the chain at the first non-zero exit. `continue` — soldier on. |
| `description:` | no | Free-text one-liner printed in the run header. |

**Execution semantics:**
- **Order = declaration order.** Python preserves dict insertion order.
- **Idempotency is YOUR responsibility.** Every step should be safe to re-run. `drizzle-kit migrate` is idempotent; seed scripts that use `INSERT … ON CONFLICT` are idempotent. Hand-rolled `INSERT` is not.
- **Failure handling.** Default = abort. The next `stack up` will retry from the failing step (idempotent prior steps re-run; the failure step gets another shot).
- **Logging.** Every step's `{ts, project, worktree, phase, step, duration_ms, exit_code}` is appended to `~/.stack/lifecycle-log.jsonl`.

**Commands:**

| Command | Effect |
|---|---|
| `stack up` | Auto-runs `lifecycle.post_up` after the stack is healthy. |
| `stack up --no-hooks` | Skip `post_up` for this one invocation. |
| `stack down` | Auto-runs `lifecycle.pre_down` before tearing the stack down. |
| `stack down --no-hooks` | Skip `pre_down`. |
| `stack lifecycle list` | Show declared hooks for both phases. Read-only. |
| `stack lifecycle run <phase>` | Run one phase ad-hoc (e.g., after manual DB reset). |

**Use cases:**

| Project need | Suggested hook |
|---|---|
| Apply schema migrations | `exec: npx drizzle-kit migrate` (or Prisma equivalent) |
| Seed reference data from a YAML manifest | `exec: node scripts/seed-<x>.bundle.cjs` |
| Warm a cache | `exec: curl localhost:4100/api/internal/warm` |
| Wait for a slow downstream service | `exec: scripts/wait-for-<x>.sh` |
| Run a smoke test before declaring up | `exec: scripts/smoke.sh` (set `on_failure: continue` if non-fatal) |

**Why this and not "run migrations in CI like prod does":** local-dev iterations need the same bootstrap recipe but applied frequently (`stack reset` drops the DB; every new worktree starts from zero). Codifying the recipe in the manifest means *both* AI agents and humans get the same fresh-stack experience without a "step 4: run migrations" tribal knowledge step.

---

### 5.9 Local HTTPS — mkcert + Caddy

Every project's `domain_dev` (e.g., `your-app.loc`) is served by Caddy with a TLS cert signed by a **local CA created by mkcert and installed in your machine's trust stores**. Browsers trust it; webhooks accept it; HSTS works correctly.

The full reference — what a CA is, why mkcert vs alternatives, cross-platform install, troubleshooting, rotation — is at [`infra/_kit/TLS.md`](_kit/TLS.md). The 30-second version:

```bash
# One time per machine
brew install mkcert nss        # macOS  (Linux/Windows: see TLS.md)
mkcert -install

# One time per project
stack tls install              # writes infra/certs/<slug>.{pem,-key.pem}
                               # reloads caddy
```

The kit:
- **Detects mkcert state in `stack doctor`** — flags missing install, CA not initialised, cert missing, cert near expiry.
- **`stack tls install`** — generates the cert, mounts it into the caddy container (via the compose volume `./certs:/etc/caddy/certs:ro`), and reloads caddy. Idempotent.
- **`stack tls status`** — shows the cert path, issuer, expiry, days remaining, trust-chain verification.
- **`stack tls renew`** — alias for `install` (mkcert overwrites cleanly).
- **`stack tls uninstall`** — deletes the project's cert files. Does NOT remove mkcert's CA from your trust stores (that's `mkcert -uninstall`, which affects ALL projects).

Files touched per project:

| File | Purpose | Committed? |
|---|---|---|
| `infra/Caddyfile.dev` | `tls /etc/caddy/certs/<slug>.pem /etc/caddy/certs/<slug>-key.pem` | yes |
| `infra/docker-compose.dev.yml` | mounts `./certs:/etc/caddy/certs:ro` into the caddy service | yes |
| `infra/certs/` | cert + key files | **NO — gitignored** |
| `.gitignore` | entry: `infra/certs/` | yes |

For new projects bootstrapped by `/infra-bootstrap`, all of the above is wired by default. For existing projects (Demoapp included), `stack tls install` performs the wiring and warns if anything is missing.

---

## 6. The kit's design decisions (decision log)

For each non-obvious choice, the reasoning.

### Why Ansible vault and not SOPS / age / Doppler / Vault?

| Tool | Trade-off |
|---|---|
| **Ansible vault** ✓ | Ships with Ansible. No external dependency. Encrypted at rest in repo. One passphrase to manage. Plays nicely with Jinja2 templating. |
| SOPS + age | Better cryptographic UX. But adds two tools to the dependency surface and per-team key management. Worth it at team size > 3. |
| HashiCorp Vault | Full audit trail, dynamic secrets, rotation hooks. Overkill at single-VPS scale. Right answer at scale. |
| Doppler / 1Password Secrets | SaaS. Single point of failure outside our infra. Not chosen because we want infra to work without internet for the secret layer. |

Current pick: **Ansible vault**. Migration path to SOPS / Vault is the `/infra-rotate-secret` skill — replace the storage backend, keep the ritual.

### Why Caddy and not nginx?

| | Caddy | nginx |
|---|---|---|
| TLS | Automatic Let's Encrypt | Manual (or certbot) |
| Config | 3 lines (`<host> { reverse_proxy <upstream> }`) | 30+ lines |
| Reload | Hot reload supported | Hot reload supported |
| Performance | Sufficient for our load | Better, marginally |

For single-VPS shapes, Caddy's automatic TLS + minimal config wins. nginx would be the choice at scale where its rich ecosystem (rate limiting, OpenResty, etc.) starts paying off.

### Why Docker Compose and not Kubernetes?

For one VPS running one application, k8s is gross over-engineering. Compose is one file, two commands. The cognitive cost of k8s — manifests, ingress controllers, secret operators, helm — buys nothing at this scale. We can migrate later; the kit's `stack triage prod` abstraction is k8s-portable.

### Why a shared `~/.stack/registry.json` and not per-project?

Mario runs many projects simultaneously and wants a **single dashboard** showing all of them. A per-project registry forces N dashboards or N filesystem-walks. A global registry is 200 bytes of state and lets the dashboard be a 200-line static HTML page.

### Why bash for the CLI?

| Option | Trade-off |
|---|---|
| bash ✓ | Zero install. Every Mac and Linux has it. Easy to read and modify. Composable with docker, psql, ssh. |
| Node | Already required by the dashboard. But for a CLI, bash's pipeline-friendly nature wins. |
| Go | Compiled, fast, but adds a build step to the kit. Friction at install time. |
| Rust | Same as Go, more friction. |

The bash CLI is around 300 lines and is the kind of thing future-Mario can read and modify in 30 minutes. That's the bar.

### Why Node (not bash) for the dashboard?

Bash + a HTTP server (e.g., `python3 -m http.server`) would work, but rendering HTML, doing TCP probes in parallel, and managing a long-running PID are all more natural in Node. The dashboard is also the kit's only "service" — and it benefits from being self-contained, with zero npm deps so install is `chmod +x` and nothing else.

### Why mkcert (and not `tls internal`, `caddy trust`, manual install, or Let's Encrypt)

| Option | Trade-off |
|---|---|
| **mkcert** ✓ | One tool. macOS + Linux + Windows + Firefox + Chromium + Safari all covered. Mature (Filippo Valsorda — Go's crypto maintainer). `mkcert -install` once per machine, then every project's certs Just Work. |
| Caddy `tls internal` | Caddy generates its own CA but doesn't install it in your OS / browser trust stores. Every project's CA is different. Per-project trust-install chore + Firefox edge cases on Linux. |
| `caddy trust` (host) | Caddy's CLI has a `caddy trust` subcommand that *can* install the local CA, but it requires Caddy on the host, has limited cross-platform support, and you still hit per-project regeneration when `stack reset` drops the caddy_data volume. |
| Let's Encrypt | Only signs publicly-resolvable hostnames. `<slug>.loc` resolves to `127.0.0.1` — LE rejects. Would require a real dynamic DNS subdomain pointing at your laptop. Fragile and slow. |
| Manual `security add-trusted-cert` | Per-project, per-OS, per-browser (Firefox NSS is separate). Trust-install becomes a chore + drifts over time. |

mkcert collapses all of those concerns into one one-time-per-machine step. The kit's `stack tls install` is the project-side wiring on top.

### Why pre-1.0 portless is optional, not required

Portless is genuinely good — git worktree detection, `.localhost` subdomains, no port-number visibility. But pre-1.0 means breaking changes between versions. The kit must work without portless, and integrate cleanly with it when present. See `GAPS_AND_ROADMAP.md` G2 for the integration plan.

### Why the dashboard is read-only

The dashboard's contract is "the truth." If it could mutate state, it becomes another source of state, which means two sources of truth can disagree. By making it strictly a viewer over `~/.stack/registry.json`, the only writers are `stack` commands — which is the simple model.

### Why `stack sandbox` and not git-worktree-per-AI-flow

Worktrees are heavy: full checkout, ~100MB on disk, slow to create. Sandboxes are cheap: one extra docker network + volumes, ~10s to spin up, reuses the primary's built image. AI agents need cheap. If a flow actually needs a separate checkout (e.g., to test a specific commit), use a real worktree and run the kit's `stack sandbox create` inside it.

---

## 7. Bootstrap a new project (porting the kit)

Use `/infra-bootstrap install --profile <vps|cloud|hybrid>` for the guided path. Behind the scenes:

1. Confirm the user picks a profile.
2. Create the `infra/_kit/` directory.
3. Copy `bin/stack`, `bin/stack-dashboard`, `lib/*.sh`.
4. Render `infra/_kit/manifest.yaml` from `templates/manifest.yaml.template` with project values.
5. If `vps` profile:
   - Render `infra/docker-compose.dev.yml` from `templates/docker-compose.dev.yml.template`.
   - Render `infra/Caddyfile.dev` from `templates/Caddyfile.dev.template`.
   - Render `infra/.env.example` from `templates/.env.example.template`.
   - Copy the `infra/ansible/` skeleton.
   - Write `.github/workflows/deploy.yml`.
6. If `cloud` profile:
   - Skip the VPS-specific files.
   - Render `.github/workflows/preview.yml`.
   - Suggest `vercel link` + `neonctl projects list` for the user to run.
7. Copy the 8 skill files to `.claude/skills/`.
8. Copy the agent file to `.claude/agents/infra.md`.
9. Update `CLAUDE.md` — append agent + skills idempotently.
10. Run `stack doctor` to verify.

The placeholders the bootstrap fills in:

| Placeholder | Source |
|---|---|
| `__APP_NAME__` | `package.json` "name" of the primary app |
| `__APP_SLUG__` | kebab-case version (`@demoapp/core` → `demoapp`) |
| `__APP_PATH__` | the workspace path of the primary app (`apps/core`) |
| `__APP_PACKAGE__` | the pnpm package name |
| `__APP_SERVICE__` | the compose service name for the app (default `core` or `web`) |
| `__DOMAIN_PROD__` | asked from the user; for `cloud`, `*.vercel.app` or custom |
| `__DEPLOY_TARGET__` | `vps` / `cloud` / `hybrid` |
| `__DEFAULT_PROFILE__` | `full` (default), `minimal`, or `cloud` |
| `__INSTALLED_AT__` | `date -u +%Y-%m-%dT%H:%M:%SZ` |

---

## 8. Constraints & invariants

These are non-negotiable. They exist because someone got bitten.

1. **Never expose Postgres on `0.0.0.0`.** Loopback-only on the VPS. Remote access via SSH tunnel.
2. **Never edit `/opt/<app>/.env` on the VPS by hand.** The next Ansible run overwrites it silently.
3. **Always pass `--timestamps` to `docker compose logs`.** Without it, lines have no time anchor.
4. **Always test webhook signatures with the redeliver button**, not with hand-crafted curl payloads. The signature is over the exact body GitHub/Slack sent.
5. **Always check `vault_postgres_password` is alphanumeric only.** Special chars break the DATABASE_URL.
6. **Always document drift in `GAPS_AND_ROADMAP.md` → Field notes.** Tomorrow's you is always your audience.
7. **Always start production triage at source-of-truth #1.** Walking out of order wastes time.
8. **Never use `git reset --hard` to "fix" a broken state.** Use `git status` + `git diff` + targeted fixes.
9. **Never run `docker system prune -a` without the unlock phrase.** It deletes layers other projects depend on.
10. **Never modify nucleus-managed files.** Check `nucleus.manifest.json` `"category": "package"` blocks.

---

## 9. Glossary

| Term | Meaning |
|---|---|
| **Profile** | A configuration variant: `full` (app+db+proxy), `minimal` (db only), `cloud` (Vercel+Neon), `vps` (Hetzner+Docker), `hybrid` |
| **Worktree** | A git worktree — same project, separate checkout, separate branch. The kit treats each one as an independent instance |
| **Sandbox** | An isolated short-lived stack spawned by `stack sandbox create`. Own DB, own network, no host ports. Auto-reaped via TTL. Replaced the legacy `--ephemeral` mode. |
| **Scenario** | A named, idempotent seed file under `seeds/` that establishes a known DB state |
| **System seed** | `00-*` — idempotent reconcilers (defaults, baseline) |
| **Fixture seed** | `10-*` — reference data |
| **Scenario seed** | `20-*` — specific test situations |
| **Ephemeral seed** | `99-*` — high-churn AI inputs, truncated by `stack seed reset` |
| **Manifest** | `infra/_kit/manifest.yaml` — the project's infra identity card |
| **Registry** | `~/.stack/registry.json` — the dashboard's source of truth for running instances |
| **Port registry** | `~/.stack/port-registry.json` — persisted port allocations per `(project, worktree)` |
| **Blast radius** | Mario's term for "what does this action change and how reversible is it" |

---

## 10. Reading list — when you need depth

| Need | Read |
|---|---|
| What the kit owns / doesn't own | `infra/_kit/OVERVIEW.md` |
| Operator how-to (`stack` commands, FAQ) | `infra/_kit/USAGE.md` |
| Required tooling, what this kit unlocks, who consumes it | `infra/_kit/CONNECTIONS.md` |
| HTTPS / mkcert / local TLS | `infra/_kit/TLS.md` |
| Current gaps + future work | `infra/_kit/GAPS_AND_ROADMAP.md` |
| The agent's routing matrix and commandments | `.claude/agents/infra.md` |
| Skill protocols (the runbooks each skill walks) | `.claude/skills/infra*/SKILL.md` |
| Scenario authoring | `infra/_kit/seeds/README.md` |
| Project-specific runbooks (preserved by the consumer) | `infra/README.md`, `infra/ansible/README.md` (only if present in that repo) |

---

## 11. Field notes

A growing list of "things that surprised me and how I handled them." Add a row every time. Future-you is your audience.

| Date | Project | Situation | Resolution | Lesson |
|---|---|---|---|---|
| 2026-06-08 | jet | `stack up` succeeded, container healthy on the allocator's port (4425), but the registry entry recorded `app=0 db=0 proxy_https=0` and the dashboard shows `health: unknown`. Root cause: `bin/stack` calls `stack_bound_port` with hardcoded internal ports (4100 for app, 5432 for db, 443 for proxy). jet's Next.js container listens on **3000** internally, so the `docker compose port board 4100` lookup returns nothing and the kit records 0. Functionality is intact — `curl http://localhost:4425` returns 200 — but the dashboard's probe loop can't find a port to TCP-connect to. | Documented as drift; did not patch the kit. The proper fix is making internal ports manifest-configurable (e.g., `services.app_internal_port: 3000`) and threading them through `stack_bound_port` calls. Logged in `GAPS_AND_ROADMAP.md`. | Nucleus's `stack_bound_port` hardcodes the standard internal ports (4100/5432/443). Any consuming project whose service uses a non-standard internal port silently lands in the registry with zeroes — dashboard health probes break, `urls:` list stays empty. Other projects that diverge from the Nucleus default (e.g., aimdall's `app=0` in registry) hit the same trap. |
| 2026-06-08 | jet | Same situation as above — dashboard rendering jet-jet with no URL because `ports.app=0`. User wanted the URL visible in `localhost:42137` immediately, before the upstream fix lands. | Manually patched `~/.stack/registry.json`: set `instances[jet-jet].ports.app = 4425` (the actual `docker port jet-board` mapping) and `urls = ["http://localhost:4425"]`. Did NOT touch `bin/stack` (nucleus-managed; would desync). Posted `/api/refresh` to dashboard; verified `health: up` with `probes.app.up: true`. Backup written to `~/.stack/registry.json.bak.<ts>`. | Manual registry patch is the right escape hatch when `bin/stack` is nucleus-managed and the upstream fix isn't deployed yet. **It does NOT survive `stack down && stack up`** — the registry write at `bin/stack:268` overwrites whatever's there. Workaround is to re-apply the patch after each up cycle until the kit fix ships from nucleus, OR avoid `stack down`. Real fix path: PR upstream against `nucleus@infra` for the `services.app_internal_port` manifest key (G12). |
| 2026-06-25 | jet | Added dev-only "packed day" seed scripts (`infra/dev-seed.mjs` / `infra/dev-clear.mjs`, wired as `pnpm seed` / `pnpm db:clear`) against host `data/board.db`. Seed builds TODAY's busy day across the 08:00–20:00 Europe/Zagreb window with a midday concurrency peak ≤ fleet 8. When run at 19:54 Zagreb (10 min before close) every booking landed in the PAST — the intended past/future mix was invisible because there was no future window left. | Made the seed time-of-day-aware: a future-tail pass adds reservations starting after `now` (clamped to 20:00) only when ≥25 min of window remain, and the summary prints an honest "window nearly over — re-run earlier for a past/future mix" note otherwise. Concurrency is enforced by a sweep-line `tryPlace` (hard FLEET ceiling + soft per-hour cap) so the board stays ≤8 at every instant regardless of run time. | A "today" seed's past/future split depends on wall-clock time of day, not just the data shape. Anchor future placements to `now` (clamped to the operating-window close) and degrade honestly near close rather than faking out-of-hours rows. Verify the concurrency invariant with an INDEPENDENT sweep query post-seed, not just the seed's own self-report. |
| 2026-07-01 | jet | Wired `APP_PASSWORD` (the login-gate secret, fail-closed per DEC-AG4) into the `board` service's `environment:` allowlist in `docker-compose.dev.yml`, then recreated the container with `docker compose --env-file infra/.env up -d --force-recreate board`. Two surprises: (1) `--force-recreate board` ALSO recreated `jet-postgres` because `board depends_on: postgres`; (2) `--env-file infra/.env` made compose read port vars from that file — but `STACK_PORT_APP`/`STACK_PORT_DB` are **commented out** there (the real values live in `infra/.ports`, exported at runtime by `stack up`'s allocator). So compose fell back to the compose-file defaults (`3000`/`5432`); board tried to bind `3000`, collided with the host `next dev`, and failed to start. `jet_pgdata` was preserved throughout (recreate ≠ `down -v`; verified via volume `CreatedAt` predating the session). | Re-ran with the correct ports restored on the CLI, which overrides `--env-file`: `STACK_PORT_APP=4426 STACK_PORT_DB=5706 docker compose --env-file infra/.env -f infra/docker-compose.dev.yml up -d`. Both containers came back on their original mappings (board 4426→3000 healthy, postgres 5706→5432 healthy), `APP_PASSWORD` present & non-empty in the container, board serving 200 on 4426, `bookings` table intact. | When recreating a hand-run jet container to pick up new env, do NOT rely on `--env-file infra/.env` for PORTS — the port vars live in `infra/.ports` (allocator output), not `infra/.env`, so `--env-file` silently defaults to `3000`/`5432` and collides with the host `next dev` on `4425`/`3000`. Either `source infra/.ports` first, or pass `STACK_PORT_APP`/`STACK_PORT_DB` explicitly on the CLI (CLI env wins over `--env-file`). Also: `--force-recreate <service>` recreates the service's `depends_on` chain too — expect postgres to bounce (harmless; named volume survives). Cleanest path for env-only changes is `stack up` (which threads `infra/.ports` correctly), reserving hand-run compose for when the allocator isn't in play. |

(See `GAPS_AND_ROADMAP.md` for the same protocol applied to design gaps rather than incidents.)
