---
name: infra-cloud-triage
description: "Production triage for Vercel-deployed projects (with optional Neon Postgres). Walks deployments, function logs, env mismatches, branch DBs, connection pools. Use for Nucleus projects that ship on Vercel + Neon — the default Nucleus deploy target when there's no microservice requirement. Invoke when the user mentions vercel, neon, preview deploy, branch DB, function timeout, edge runtime, or production issues on a non-VPS project."
---

# /infra-cloud-triage — Vercel + Neon Production Triage

> **⚠ ADVISORY-ONLY SKILL.** Per Commandment Four (Remote Systems Are Read-Only-By-Human), the agent does **not** execute any `vercel`, `neonctl`, `psql`-against-Neon, `gh`, or production-`curl` command in this skill. Every command block below is something you **suggest** to the user — print the exact command with a one-line explanation and blast radius, then wait. The user runs it and pastes output back. The agent reads output, advises, and suggests the next probe. The agent never authenticates to Vercel or Neon itself.
>
> The walkthroughs, decision tables, and command snippets below are reference material the user reads and acts on, not a script the agent runs.

You operate the cloud-flavored triage ladder for Nucleus projects that deploy to
Vercel (frontend + serverless functions) with Neon (serverless Postgres with
copy-on-write branches). The architecture is fundamentally different from the
VPS shape — there is no Caddy, no SSH, no `docker compose logs`. The sources of
truth live in Vercel and Neon CLIs.

For VPS-deployed projects (Docker Compose + Caddy + Ansible), route to
`/infra-prod-triage` instead.

---

## When to invoke

Trigger this skill when the user mentions any of:

- Vercel deployment failure, build error, or cancelled build
- Function timeout, 500 error, or unhandled exception in production
- Preview deploy is broken or missing expected data
- `DATABASE_URL is not defined` or env var absent on Vercel
- Production pointing at a branch DB (data looks "old" or "wrong")
- Stale build shipped (git SHA doesn't match what's running)
- Neon autosuspend cold-start latency spike
- Connection pool exhaustion (`too many connections`, `ECONNRESET`)
- Branch DB not cleaned up after PR merge
- Rollback needed after a bad deploy

---

## Companion tools — install and authenticate

```bash
# Vercel CLI
npm install -g vercel
vercel login                      # browser OAuth
vercel whoami                     # verify scope
vercel link                       # link to the project (writes .vercel/project.json)

# Neon CLI
npm install -g neonctl
neonctl auth                      # browser OAuth
neonctl projects list             # verify access

# psql — for raw Neon queries
# macOS: brew install libpq && brew link --force libpq
# Ubuntu: apt-get install -y postgresql-client
```

---

## The four sources of truth (walk in order)

| # | Source | Answers | Command |
|---|--------|---------|---------|
| L1 | Vercel deployment status | Did the build succeed? Is the right code deployed? | `vercel ls` |
| L2 | Vercel function / runtime logs | Did the handler execute? Did it throw? Did it timeout? | `vercel logs <url> --since 1h` |
| L3 | Vercel environment variables | Did the function have the env it needed? | `vercel env ls production` |
| L4 | Neon database | Did the expected rows persist? Is the DB alive? | `neonctl branches list` + psql |

Always start at L1. A build error at L1 means L2–L4 are irrelevant. If L1 is
green but users are seeing errors, walk through L2–L4 in order.

---

## L1 — Vercel deployment status

```bash
vercel ls                                     # list recent deployments
vercel ls --scope <team>                      # if in a team context
```

Status vocabulary:

| Status | Meaning | Next step |
|--------|---------|-----------|
| `READY` | Build succeeded, traffic is live | Check L2 if errors reported |
| `ERROR` | Build failed | `vercel inspect <dpl-id> --logs` |
| `BUILDING` | Build in progress | Wait or cancel with Vercel dashboard |
| `CANCELED` | Deploy was cancelled (by force-push, duplicate trigger) | Re-push or trigger from dashboard |

For a failed build:

```bash
vercel inspect <deployment-id> --logs        # full build log
```

Common build failures and their causes:

| Failure | Cause |
|---------|-------|
| `Type error: ...` | TypeScript regression; missed locally. Fix and repush. |
| `Module not found: ...` | Missing dep in lockfile. Run `pnpm install` locally, commit the lockfile. |
| `Build exceeded maximum duration` | Runaway codegen or infinite loop in the build script. Check `prebuild` / `generateStaticParams`. |
| `ENOENT: .next/...` | Wrong `outputDirectory` in `vercel.json`. Check `__APP_PATH__/.next`. |

Check that the deployed SHA matches HEAD:

```bash
git log -1 --format="%H"                      # local HEAD
vercel ls | head -5                            # latest deployment's git SHA (shown in output)
```

If they differ, the old build is still live — trigger a new deploy:

```bash
vercel --prod                                  # redeploy from local build
# or: push an empty commit to main
```

---

## L2 — Vercel function and runtime logs

For errors after a successful build:

```bash
vercel logs <production-url> --since 1h       # last hour
vercel logs <production-url> --since 30m --output raw   # raw, pipe-friendly
vercel logs <production-url> --follow         # stream (Ctrl-C to stop)
```

Filter for errors:

```bash
vercel logs <production-url> --since 1h --output raw \
  | grep -iE 'error|exception|unhandled|timeout|SIGTERM'
```

The output includes the function path (`/api/webhooks/github`), execution
duration, HTTP status, and any `console.error` / `console.log` output.

Common runtime failures:

| Symptom in logs | Cause | Fix |
|----------------|-------|-----|
| `Task timed out after Xs` | Function exceeded plan limit (10s hobby / 60s pro / 300s enterprise) | Identify slow query via Neon `EXPLAIN ANALYZE`; optimize or increase `maxDuration` in `vercel.json` |
| `RangeError: Maximum call stack exceeded` | Infinite recursion | Read the stack trace; fix the loop |
| `Error: DATABASE_URL is not defined` | Env var missing in Vercel | Jump to L3 |
| `connect ECONNREFUSED` | Neon endpoint suspended + cold start timed out | See autosuspend section below |
| `too many connections` | Connection pool exhaustion | See connection pool section below |
| `FUNCTION_INVOCATION_TIMEOUT` | Same as task timeout above | Same fix |
| Unhandled promise rejection | Missing `await` or uncaught async error | Read the function path from the log; add error boundary |

---

## L3 — Vercel environment variables

The #1 silent failure in Vercel is "production has different env than local."
Compare scopes:

```bash
vercel env ls production         # what production functions see
vercel env ls preview            # what preview deployments see
vercel env ls development        # what `vercel dev` sees locally
```

Pull the current production env to a local file for diffing:

```bash
vercel env pull .env.vercel.production --environment=production
diff .env.vercel.production infra/.env.cloud.production.example
```

If a variable is missing in production:

```bash
vercel env add DATABASE_URL production
# (prompted for value — paste the Neon pooled connection string)
```

Then redeploy — env changes do NOT take effect until the next deployment:

```bash
vercel --prod
# or push a commit to main to trigger the workflow
```

Watch for these mismatches:

| Mismatch | Symptom | Fix |
|----------|---------|-----|
| `DATABASE_URL` absent | `Error: DATABASE_URL is not defined` at startup | Add pooled Neon URL to Vercel prod env |
| `DIRECT_DATABASE_URL` absent | Migrations fail in CI | Add direct Neon URL as a repo secret (`DATABASE_URL` in the workflow) |
| `NEXTAUTH_URL` wrong | OAuth redirect loops; `OAuthCallbackError` | Must match the deployed domain exactly, no trailing slash |
| `NEXTAUTH_SECRET` absent | All sessions invalid | Generate with `openssl rand -base64 32`; add to Vercel prod env |
| Preview points at prod DB | Preview data overwrites production | Add separate preview `DATABASE_URL` pointing at a `preview/stable` Neon branch |

---

## L4 — Neon database

### Branch and endpoint health

```bash
neonctl projects list                                    # all projects; get project ID
neonctl branches list --project-id <id>                  # branches for this project
neonctl endpoints list --project-id <id>                 # compute endpoints + suspend state
```

Endpoint states:

| State | Meaning | Action |
|-------|---------|--------|
| `active` | Running, accepting connections | Normal |
| `idle` | Running but no active queries | Normal |
| `suspended` | Autosuspended — will wake on next connection | First request pays ~200–500ms cold start |

Get a connection string:

```bash
neonctl connection-string main --project-id <id> --pooled      # pooled (pgbouncer)
neonctl connection-string main --project-id <id>               # direct (for migrations)
```

Connect with psql:

```bash
psql "$(neonctl connection-string main --project-id <id> --pooled)"
```

Check active connections:

```sql
SELECT pid, usename, application_name, state, wait_event_type, query_start
FROM pg_stat_activity
WHERE datname = current_database()
ORDER BY query_start DESC NULLS LAST;
```

---

## Common incidents — runbook

| Symptom | Source | Command | Fix |
|---------|--------|---------|-----|
| 500 errors on a route | L2 | `vercel logs <url> --since 1h` | Read function log; fix the throw |
| `DATABASE_URL is not defined` | L3 | `vercel env ls production` | Add pooled Neon URL; redeploy |
| Function timeout | L2 → L4 | `vercel logs` → `EXPLAIN ANALYZE` in psql | Add index or reduce N+1; increase `maxDuration` if justified |
| Preview deploy missing data | L4 | `neonctl branches list` | Neon branch wasn't seeded; run `stack seed apply` against branch URL |
| Production points at branch DB | L3 | `vercel env ls production` | `DATABASE_URL` is set to a `pr/*` branch URL; update to `main` URL; redeploy |
| Stale build / old code shipped | L1 | `vercel ls` + `git log -1 --format="%H"` | SHA mismatch; trigger `vercel --prod` |
| Cold-start latency (1–3s first req) | L4 | `neonctl endpoints list` | Autosuspend kicked in; disable for main branch on paid plan |
| Connection pool exhaustion | L2 → L4 | `vercel logs` + `pg_stat_activity` | Switch to pooled connection string; kill stale connections (see below) |
| `too many connections` on Neon | L4 | psql → `pg_stat_activity` | Kill idle connections (see below); consider upgrading Neon plan |

Kill idle connections when pool is exhausted:

```sql
-- Preview before running:
SELECT pid, usename, state, application_name
FROM pg_stat_activity
WHERE state = 'idle'
  AND datname = current_database()
  AND pid <> pg_backend_pid();

-- Then terminate them (declare blast radius first — active transactions will rollback):
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'idle'
  AND datname = current_database()
  AND pid <> pg_backend_pid();
```

---

## Rollback procedure

Vercel rollback is instant and does not require a rebuild:

```bash
vercel rollback                              # interactive — pick from recent deployments
vercel promote <deployment-id> --scope <team>  # explicit by deployment ID
```

Declare blast radius before rolling back:
- All production traffic shifts to the promoted build immediately.
- Database schema is NOT reverted — Neon branches are independent of Vercel.
- If the old build is incompatible with the current schema, you have a
  schema-divergence situation. In that case, promoting "the last good deploy"
  may not be the right target — pick the last deploy that is schema-compatible.

If a migration also needs to be undone:
- `drizzle-kit drop` is destructive — use with extreme caution and only in
  staging unless forced.
- The safer path is to roll forward: write a corrective migration instead of
  reversing the bad one.
- For data recovery, use Neon point-in-time restore (see below).

### Neon point-in-time recovery

```bash
# Create a branch from 2 hours ago
neonctl branches create \
  --project-id <id> \
  --name recovery/2h-ago \
  --parent main \
  --parent-timestamp "$(date -u -v-2H +%Y-%m-%dT%H:%M:%SZ)"

# Inspect the data on the recovery branch
psql "$(neonctl connection-string recovery/2h-ago --project-id <id>)"

# If data looks correct, swap DATABASE_URL in Vercel to point at the recovery
# branch, redeploy, and verify. Then either:
#   a) Promote the recovery branch to main (neonctl — requires care), or
#   b) Copy the missing data back into main manually via psql.
```

---

## Branch DB workflow — the Neon-per-PR pattern

The `.github/workflows/preview.yml` workflow handles this automatically:

1. PR opened → `neondatabase/create-branch-action@v5` creates `pr/<number>` from `main`.
2. Drizzle Kit migrations run against the new branch.
3. Vercel preview deploy receives `DATABASE_URL` pointing at the branch (pooled).
4. PR comment is posted with the Vercel preview URL and the Neon branch connection string.
5. PR closed → `neondatabase/delete-branch-action@v3` deletes the branch.

For debugging a PR's database locally:

```bash
# Get the connection string for pr/42
neonctl connection-string pr/42 --project-id <id>

# Connect with psql
psql "$(neonctl connection-string pr/42 --project-id <id>)"

# Seed the branch with a scenario
DATABASE_URL="$(neonctl connection-string pr/42 --project-id <id>)" \
  npx drizzle-kit migrate
DATABASE_URL="$(neonctl connection-string pr/42 --project-id <id>)" \
  infra/_kit/bin/stack seed apply <scenario>
```

If a branch wasn't cleaned up after PR close:

```bash
# List all pr/* branches
neonctl branches list --project-id <id> | grep "pr/"

# Delete a specific one
neonctl branches delete pr/42 --project-id <id>
```

---

## Autosuspend mental model

Neon endpoints autosuspend after idle time to save compute.

| Plan | Default idle timeout | Cold-start latency |
|------|---------------------|-------------------|
| Free | 5 minutes | ~200–500ms |
| Launch / Scale | Configurable (min 1 min) | ~200–500ms |
| Business | Configurable; can be disabled | ~200ms |

**Symptom:** occasional 1–3s first-request latency on production after a quiet
period. Subsequent requests are normal — only the first pays the cold start.
This is autosuspend, not your code.

**Mitigation options (in order of cost):**
1. Accept it — usually <500ms and only on the first request after idle.
2. Use a connection pooler URL (pgbouncer) — the pooler itself stays resident
   even when the compute is suspended, so it absorbs the reconnect.
3. Disable autosuspend on the main branch (paid plan required).
4. Send a keepalive `SELECT 1` query on a cron schedule (e.g., every 4 minutes)
   to prevent suspension during business hours.

---

## What this skill does NOT do

- ❌ Execute **any** `vercel`, `neonctl`, or production-`psql` command — read or write. The agent prints; the user runs. (Commandment Four.)
- ❌ Authenticate to Vercel or Neon. `vercel login` / `neonctl auth` happen on the user's machine, in the user's session, never under the agent's control.
- ❌ Run `vercel --prod`, `vercel rollback`, `vercel promote` — production deploys are user-initiated.
- ❌ Create, delete, or query Neon branches. The user runs all `neonctl branches *` commands.
- ❌ Read or edit production environment variables in Vercel. The user runs `vercel env ls` / `vercel env add` and pastes results.
- ❌ Run destructive SQL on Neon (`DROP`, `DELETE`, `TRUNCATE`, `pg_terminate_backend`) — and since the agent doesn't run remote SQL at all right now, this is the user's keyboard exclusively.
- ❌ Rotate secrets — route to `/infra-rotate-secret`, which is also advisory-only.

---

## Self-check

- [ ] Did I check L1 (deployment status) before assuming a code issue?
- [ ] Did I read L2 (function logs) before assuming an env or DB issue?
- [ ] Did I diff L3 (env vars) before assuming a missing-config issue?
- [ ] Did I check Neon branch state before assuming a data issue?
- [ ] Did I declare blast radius before any rollback, env edit, or branch op?
- [ ] Did I verify (state-after) using the same probes I used to diagnose?
