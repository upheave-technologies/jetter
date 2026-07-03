# Infra — Jet Ski Booth Board

Local development infrastructure for the Booth Board. Two services: the Next.js
app (`board`) and PostgreSQL (`postgres`). The board talks to Postgres over the
compose network; the database lives in a named `pgdata` volume that survives
`docker compose down`. Production runs the same app against **Neon** (serverless
Postgres) via the same `DATABASE_URL` contract.

```
┌──────────────────────────────────────────────────────────────────────┐
│  host                                                                  │
│                                                                        │
│  http://localhost:${STACK_PORT_APP:-3000}     localhost:${STACK_PORT_DB:-5432}
│    │                                                  │  (host tooling:  │
│    ▼                                                  │   pnpm db:migrate │
│  ┌────────────────────────┐       compose net         │   pnpm seed)      │
│  │ container: jet-board   │ ───────────────────────►  │                   │
│  │  Next.js 16 standalone │   DATABASE_URL =          ▼                   │
│  │  reads DATABASE_URL    │   postgres://jet:jet@  ┌────────────────────┐ │
│  └────────────────────────┘   postgres:5432/jet   │ container:          │ │
│                                                    │   jet-postgres      │ │
│                                                    │   PostgreSQL 16     │ │
│                                                    │   /var/lib/postgres │ │
│                                                    │       /data ──────┐ │ │
│                                                    └────────────────── │ ┘ │
│                                                                        │   │
│   named volume: pgdata  ◄──────────────────────────────────────────────┘   │
│                                                                        │
└──────────────────────────────────────────────────────────────────────┘
```

Two `DATABASE_URL`s exist, intentionally:
- **In-network** (`postgres://jet:jet@postgres:5432/jet`) — the board *container*
  reaches the DB by the compose service name. Set in `docker-compose.dev.yml`.
- **Host-facing** (`postgres://jet:jet@localhost:${STACK_PORT_DB:-5432}/jet`) —
  *host* tooling (`pnpm db:migrate`, `pnpm seed`, `pnpm db:clear`) reaches the DB
  through the mapped localhost port. Set in `infra/.env`.

---

## Quick start

```bash
# 1. Copy the env template (the local defaults are throwaway, not secrets).
cp infra/.env.example infra/.env

# 2. Bring up postgres + board. Preferred path — wires the dashboard, port
#    allocator, and registry at localhost:42137 for cross-project visibility.
infra/_kit/bin/stack up
#    Or plain docker compose:
#    pnpm docker:build && pnpm docker:up

# 3. Apply the schema to the fresh database (real drizzle-kit migrations, run
#    FROM THE HOST — the board image deliberately does NOT carry the migrator).
#    Export the host-facing DATABASE_URL from infra/.env first:
export $(grep -v '^#' infra/.env | xargs)
pnpm db:migrate

# 4. (Optional) Load a packed demo day.
pnpm seed
```

Then open `http://localhost:3000/` (or whatever `STACK_PORT_APP` resolves to —
check `infra/.ports` after `stack up`).

> If you ran through `stack up`, the allocator already exported a worktree-
> specific `STACK_PORT_DB`. The `export $(grep -v '^#' infra/.env | xargs)` line
> picks up the host-facing `DATABASE_URL`; it resolves `${STACK_PORT_DB:-5432}`
> from your shell, so export `STACK_PORT_DB` (or run the migrate/seed commands in
> the same shell `stack up` ran in) if you're not on the default 5432.

## Stop

```bash
infra/_kit/bin/stack down       # graceful, KEEPS the pgdata volume
# or
pnpm docker:down
```

The `pgdata` volume persists. Next time you bring the stack up, the board comes
back with the same bookings.

## Logs

```bash
infra/_kit/bin/stack logs board --follow
infra/_kit/bin/stack logs postgres --follow
# or
pnpm docker:logs
```

## Reset the database

The data lives in the named `pgdata` volume. Dropping it is **destructive** —
it wipes every booking (infra-commandments §5; never do this casually).

```bash
# Nuke containers AND the pgdata volume, then start fresh:
infra/_kit/bin/stack down
docker compose -f infra/docker-compose.dev.yml down -v   # the -v drops pgdata
infra/_kit/bin/stack up
export $(grep -v '^#' infra/.env | xargs)
pnpm db:migrate                                          # re-apply schema
pnpm seed                                                # re-load the demo day
```

If you only want to empty the `bookings` table (keep the schema and volume):

```bash
export $(grep -v '^#' infra/.env | xargs)
pnpm db:clear
```

A fresh volume has no schema until `pnpm db:migrate` runs — there is no longer a
lazy `CREATE TABLE` bootstrap. Migrations are the only path to the schema.

## Inspect the database

```bash
# Through the kit:
infra/_kit/bin/stack psql

# Or straight into the container:
docker compose -f infra/docker-compose.dev.yml exec postgres psql -U jet jet

# One-shot query (host tooling via the mapped port):
docker compose -f infra/docker-compose.dev.yml exec postgres \
  psql -U jet jet -c "SELECT id, quantity, status, kind, start_time FROM bookings ORDER BY start_time DESC LIMIT 20;"
```

`start_time` / `end_time` / `created_at` / `updated_at` are `timestamptz`, so
psql renders them as real timestamps (no `datetime(.../1000)` unix-ms dance the
SQLite build needed).

---

## What's intentionally NOT here

| Not present | Why |
|---|---|
| Redis / queue | No background work. The board polls; mutations are synchronous. |
| Caddy / TLS | Operators reach the board on `localhost`, where plain HTTP is fine. Adding HTTPS would require `mkcert -install` (touches the system trust store) and a `127.0.0.1 board.loc` entry in `/etc/hosts` — both are operator-machine writes the kit deliberately doesn't perform without explicit consent (Commandment Three). If you want TLS, see "Optional: adding HTTPS" below. |
| Auth / sessions / secrets | Favor-grade build — no client administration, no login. The local Postgres credentials (`jet`/`jet`/`jet`) are throwaway dev values, not secrets; the only real secret is the production Neon connection string, which lives in the deploy/Vercel env and never in git. |

**Now present (was NOT, in the SQLite era):**

| Present | Why |
|---|---|
| **PostgreSQL** | The storage choice. Local dev runs Postgres 16 in Docker; production runs Neon. One `DATABASE_URL` contract, the node-postgres `pg` driver, in both. (Replaces the SQLite `data/board.db` file.) |
| **Migrations runner** | Schema is provisioned by real `drizzle-kit` migrations (`pnpm db:generate` to author, `pnpm db:migrate` to apply). The migration history lives under `modules/bookings/schema/migrations/`. The runner is a devDependency and is intentionally absent from the production image — migrations are a deploy/host step, never a runtime-container step. (Replaces the SQLite lazy `CREATE TABLE IF NOT EXISTS` bootstrap.) |

---

## Production: Neon  (GUIDE-ONLY)

Production runs the board against **Neon** — serverless Postgres with
copy-on-write branches. The app is identical; only the `DATABASE_URL` differs.

> **You run every Neon/cloud command yourself.** Per infra-commandments §4, the
> infra agent never executes remote/cloud commands (`neonctl`, `vercel`, deploy
> migrations) — it guides, you execute. The steps below are a runbook for *you*.

### 1. Get the Neon connection string

In the Neon console (or `neonctl connection-string main --project-id <id> --pooled`),
copy the connection string. Two requirements:
- **Pooled host** — use the `-pooler` subdomain
  (`ep-xxxx-pooler.REGION.aws.neon.tech`). Serverless functions open many short
  connections; the pooler keeps a small server-side pool resident so you don't
  exhaust Postgres's connection limit.
- **`?sslmode=require`** — Neon refuses non-TLS connections.

Result shape:
```
postgres://USER:PASSWORD@ep-xxxx-pooler.REGION.aws.neon.tech/DB?sslmode=require
```

### 2. Set `DATABASE_URL` in the deploy env

Set it in Vercel (or your deploy platform's) environment — **never** in git,
never in `infra/.env`. For Vercel:
```bash
vercel env add DATABASE_URL production   # paste the pooled Neon URL when prompted
```
Env changes don't take effect until the next deploy (`vercel --prod` or a push
that triggers the workflow).

### 3. Run migrations against Neon as a deploy step

jet has **two** independent drizzle-kit migration sets — `bookings`
(`drizzle.config.ts`) and `audit` (`drizzle.audit.config.ts`) — and **both**
must be applied on every deploy. They are wrapped in one fail-closed runner,
`scripts/migrate-deploy.mjs`, exposed as `pnpm db:migrate:deploy`:

> **⚠️ Deploys are done by Vercel's NATIVE Git integration, NOT GitHub Actions.**
> The GitHub Actions workflow that used to run migrations-on-deploy is **DISABLED**
> — it now lives at `.github/workflows/deploy.yml.disabled` (kept as a backup /
> reference; the `.disabled` extension makes it dormant). Vercel builds and
> deploys the app directly on push/PR, and does not run drizzle migrations on its
> own — so migrations are wired into the Vercel **build** via a `vercel-build`
> script (below). Migrations run automatically again, on **production deploys
> only**.

- **Vercel build migrate step (this is what runs automatically now).**
  `package.json` defines a `vercel-build` script — Vercel runs `vercel-build` in
  preference to `build` when present:
  ```json
  "vercel-build": "node scripts/migrate-deploy.mjs && next build"
  ```
  Migrations run **first**, then `next build`. Because the two are chained with
  `&&`, a failed migration aborts the build and **nothing is promoted**
  (fail-closed, the same contract the disabled workflow had — the app is never
  pointed at a half-migrated database). `scripts/migrate-deploy.mjs` enforces two
  guards:
  - **Production-only.** It migrates **iff** `VERCEL_ENV === 'production'`.
    Preview and development builds log a one-line skip and proceed straight to
    the build. Rationale: with the old workflow disabled there is no longer any
    Neon branch-per-PR automation, so a preview build has no per-preview branch
    DB to target and must never migrate the production database. (Invoked outside
    a Vercel build — `VERCEL` unset — the guard is inert, so manual/CI runs
    behave exactly as before.)
  - **DIRECT url, not pooled — REQUIRED on a production build.** It uses
    `NEON_DIRECT_DATABASE_URL` (the Neon **DIRECT**, non-`-pooler` url) and injects
    it as `DATABASE_URL` for the child `drizzle-kit` processes only — it does
    **not** overwrite the app's runtime pooled `DATABASE_URL`. drizzle-kit migrate
    opens a long multi-statement session that pgbouncer transaction pooling
    breaks, so migrations need the direct url while the running app keeps the
    pooled one. On a **production** Vercel build (`VERCEL_ENV === 'production'`)
    this var is **mandatory**: if it is unset/empty the build **fails fast**
    (`exit 1`, nothing promoted) rather than silently falling back to the pooled
    `DATABASE_URL` — because the pooled url would hang `drizzle-kit migrate`. Set
    it as a Vercel Production env var (step 3a). Outside a production build
    (manual/CI, or Vercel preview/dev which skip), the previous behavior is
    unchanged: prefer `NEON_DIRECT_DATABASE_URL` if present, else use `DATABASE_URL`.
  - **Timeout, fail-closed.** Each `drizzle-kit migrate` child is bounded by a
    120 s timeout. A stall (misconfig, wrong host, network black hole, a wedged
    pooled session) is killed and treated as a failure — the build aborts with a
    message naming the failing set (`bookings`/`audit`) instead of hanging until
    Vercel's outer build timeout.

  You must set `NEON_DIRECT_DATABASE_URL` as a Vercel **Production** environment
  variable (the Neon MAIN branch **direct**, non-pooled url,
  `?sslmode=require`) — see step 3a below. Re-enabling the old GitHub Actions
  workflow instead: rename `deploy.yml.disabled` back to `deploy.yml` (needs
  `workflow` push scope); if you do, drop the `vercel-build` migrate step to
  avoid migrating twice.

- **One-off from your machine** (emergency / manual deploy):
  ```bash
  DATABASE_URL="postgres://USER:PASSWORD@ep-xxxx.REGION.aws.neon.tech/DB?sslmode=require" \
    pnpm db:migrate:deploy
  ```
  Runs bookings then audit, aborting on the first failure. `VERCEL` is unset
  here, so the production-only guard does not apply — it migrates whatever
  `DATABASE_URL` (or `NEON_DIRECT_DATABASE_URL`, if you prefer to set that) points
  at. Use the *direct* host (no `-pooler`) for migrations; the *pooled* host is
  for the running app.

Migrations are applied with the **direct** (non-pooled) URL — pgbouncer's
transaction pooling can interfere with the migration session. Idempotency is
free: `drizzle-kit migrate` tracks applied migrations per journal, so re-running
a deploy with no new migration files is a no-op for both sets — every re-deploy
runs the migrate step and, when there is nothing new, does nothing.

### 3a. Set `NEON_DIRECT_DATABASE_URL` on Vercel (Production)  ← REQUIRED for the above

The `vercel-build` migrate step reads `NEON_DIRECT_DATABASE_URL`. On a
**production** deploy this variable is **required** — if it is missing/empty the
build fails fast (`exit 1`) and nothing is promoted; the step never falls back to
the pooled `DATABASE_URL` (which would hang `drizzle-kit migrate`). Set it as a
Vercel **Production**-scoped environment variable, holding the Neon MAIN branch
**DIRECT** (non-pooled) connection string:

```bash
# You run this — the infra agent never sets Vercel env (infra-commandments §4).
# Value: the DIRECT host (NO `-pooler` subdomain), ?sslmode=require.
vercel env add NEON_DIRECT_DATABASE_URL production
#   postgres://USER:PASSWORD@ep-xxxx.REGION.aws.neon.tech/DB?sslmode=require
```

Do NOT scope it to Preview/Development — the build guard skips migrations there
anyway, and there is no branch DB to point it at. This is the SAME database the
app already uses (the app's runtime `DATABASE_URL` is just the **pooled**,
`-pooler`, variant), so it is not a new secret domain — the two-pipelines rule
(infra-commandments §7) is preserved. Env changes take effect on the next
deploy.

**Previews are NOT auto-migrated.** Preview and development builds skip the
migrate step entirely (production-only guard). If a preview needs a migrated
schema, migrate its branch DB manually — see `/infra-cloud-triage` for the
branch-DB walkthrough — or re-enable the disabled workflow's Neon-branch-per-PR
automation.

### 4. Branch-per-PR (preview environments)

Neon's copy-on-write branches make per-PR preview databases cheap: a CI workflow
creates a `pr/<n>` branch off `main` on PR open, runs migrations against it,
points the Vercel preview deploy's `DATABASE_URL` at the branch, and deletes the
branch on PR close. **Note:** the preview-branch + preview-migrate automation
also lived in the now-**disabled** `deploy.yml.disabled` workflow, so it is not
running either — with Vercel-native deploys, preview branch/migration wiring is
currently manual (or would need to be re-enabled). See `/infra-cloud-triage`
for the full Vercel + Neon triage and branch-DB walkthrough.

For deeper cloud triage (deployment status, function logs, env mismatches,
branch-DB debugging, connection-pool exhaustion, autosuspend cold starts),
invoke the `/infra-cloud-triage` skill.

---

## Optional: adding HTTPS later

If a real public-facing local URL becomes a requirement, Caddy fronting the app
is the smallest possible addition. The shape would be:

1. Add a `caddy` service to `infra/docker-compose.dev.yml`:
   ```yaml
   caddy:
     image: caddy:2-alpine
     ports: ["80:80", "443:443"]
     volumes:
       - ./Caddyfile.dev:/etc/caddy/Caddyfile:ro
       - caddy_data:/data
     depends_on: { board: { condition: service_healthy } }
   ```
2. Write `infra/Caddyfile.dev`:
   ```
   board.loc {
     reverse_proxy board:3000
   }
   ```
3. The operator runs ONCE on their own machine (the kit does not do this):
   ```bash
   sudo sh -c 'echo "127.0.0.1 board.loc" >> /etc/hosts'
   mkcert -install   # trust Caddy's auto-generated certs
   ```
4. `infra/_kit/bin/stack tls install` would handle the cert plumbing if wired
   up, but the operator still has to consent to the trust-store edit.

The local-dev path skips all of this.

---

## File layout

```
infra/
├── README.md                  ← this file
├── docker-compose.dev.yml     ← two-service compose (postgres + board)
├── .env.example               ← documented env knobs + Neon reference (annotated)
├── .env                       ← (gitignored) operator overrides
├── .ports                     ← (gitignored) port allocator output
├── dev-seed.mjs               ← packed-day demo seed (pg; reads DATABASE_URL)
├── dev-clear.mjs              ← empties the bookings table (pg; reads DATABASE_URL)
└── _kit/                      ← nucleus stack kit (do not edit)

Dockerfile                     ← multi-stage; builder → runner (pure-JS pg, no native addon)
.dockerignore                  ← keeps node_modules / secrets out of the build context
modules/bookings/schema/migrations/   ← drizzle-kit migration history
drizzle.config.ts              ← drizzle-kit config (dialect: postgresql)
```

---

## When to call infra/_kit/bin/stack vs raw `docker compose`

| Situation | Use |
|---|---|
| Day-to-day dev on one machine | `stack up` — registers in the dashboard, allocates a worktree-specific port for BOTH board and postgres, persists across `git worktree` switches. |
| You don't have the kit's prereqs (Python for the dashboard, etc.) | `pnpm docker:up` — bypasses the kit, talks to compose directly. |
| Multiple worktrees of the same repo open at once | `stack up` — the allocator gives each worktree its own host ports; raw compose will collide on 3000/5432. |
| CI / scripting | Raw `docker compose` — deterministic, no per-machine kit state. |
| Sandbox / parallel test instance | `stack sandbox create` — see the kit's USAGE.md. |
