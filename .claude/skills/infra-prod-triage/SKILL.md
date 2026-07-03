---
name: infra-prod-triage
description: "Diagnose any production problem on a VPS-deployed project (Docker Compose + Caddy + Postgres). Walks the four sources of truth in order: provider → Caddy → Core → DB. Covers webhook failures, deploy issues, TLS, restart loops, slow responses, and disk pressure. Invoke when the user mentions 'prod down', 'webhook 401', 'production logs', 'deployment broken', 'TLS error', 'health check', or any production-incident shape."
---

# /infra-prod-triage — VPS Production Triage

> **⚠ ADVISORY-ONLY SKILL.** Per Commandment Four (Remote Systems Are Read-Only-By-Human), the agent does **not** execute any command in this skill. Every `ssh`, `docker compose`, `psql`-via-tunnel, `gh`, and `curl`-against-prod block below is something you **suggest** to the user — print the exact command with a one-line explanation and blast radius, then wait. The user runs it on their machine and pastes the output back. The agent reads output, advises, and suggests the next command. The agent never opens an SSH connection itself.
>
> The walkthroughs, decision tables, and command snippets below are reference material the user reads and acts on, not a script the agent runs.

You walk the production-diagnostic ladder for VPS-deployed Nucleus projects. The shape is universal: Caddy reverse-proxies to a Next.js Core container that talks to a local Postgres. The triage protocol is **always** to walk the sources of truth in order.

For Vercel/Neon-deployed projects, route to `/infra-cloud-triage` instead.

---

## Invocation

| Command | Action |
|---|---|
| `/infra-prod-triage` | Health summary of every monitored layer |
| `/infra-prod-triage webhook [github\|slack]` | Walk the webhook diagnostic ladder |
| `/infra-prod-triage logs [<service>] [--since <when>]` | Pull and analyze logs |
| `/infra-prod-triage db <query>` | Run a read-only query against prod (via SSH tunnel + psql) |
| `/infra-prod-triage health` | Run health endpoints + signature smoke tests |
| `/infra-prod-triage deploy` | Show the last deploy's verdict and any failure modes |
| `/infra-prod-triage tls` | Check Caddy certs + Let's Encrypt status |
| `/infra-prod-triage disk` | Check disk pressure on `/var/lib/docker` and `/opt/<app>` |
| `/infra-prod-triage restart <service>` | Restart a service after declaring blast radius |

---

## The four sources of truth (in walking order)

This is the universal protocol — every triage starts here.

| # | Source | Answers | How |
|---|---|---|---|
| 1 | Provider's "Recent Deliveries" UI (GitHub App / Slack App) | Did the provider try? What did our server return? | GitHub: `https://github.com/.../settings/apps/<app>/advanced` · Slack: `https://api.slack.com/apps/<id>` |
| 2 | Caddy access log on the VPS | Did the request reach the box? Did it 2xx, 4xx, 5xx? | `ssh ... "cd /opt/<app> && docker compose logs --since 5m --timestamps caddy"` |
| 3 | Core stdout on the VPS | Did the handler run? Did it crash or reject? | `ssh ... "cd /opt/<app> && docker compose logs --since 5m --timestamps core"` |
| 4 | Relevant table in Postgres | Did anything persist? | `ssh ... "cd /opt/<app> && docker compose exec -T postgres psql -U <user> -c '<query>'"` |

Always start at 1. If 1 already tells you the failure (e.g., 401), 2-4 don't need to run. If 1 says success but the user reports nothing happened, walk all the way to 4.

---

## Webhook triage

When the user says "webhooks not working":

### Step 1 — Provider's delivery UI

Ask the user (or open via gh CLI / browser):
- GitHub: app advanced page → Recent Deliveries → expand the failing delivery → check the **Response** tab.
- Slack: api.slack.com app → Event Subscriptions → Activity tab.

Map the response code:

| Code | What it means | Next step |
|---|---|---|
| `200` | Handler accepted (may have swallowed downstream errors) | Step 4 — confirm DB persistence |
| `401` | Signature mismatch | See **"Diagnosing a 401"** below |
| `400` | Invalid JSON / signature parse failure | Re-check delivery payload tab |
| `404` | Wrong webhook URL | Compare provider URL vs. `https://<domain>/api/webhooks/<provider>` |
| `5xx` | Container crashed mid-handler | Step 3 — read core logs |
| timeout | Container not running OR Caddy not routing OR DNS | Step 2 then `stack ps` analog |

### Diagnosing a 401

A 401 always means signature verification failed. Standard causes, in real-world frequency order:

**1. Secret in container ≠ secret at provider.**
```bash
ssh deploy@<host> "docker compose -f /opt/<app>/docker-compose.yml exec core printenv <APP>_WEBHOOK_SECRET"
```
Compare to the value in the provider's UI. If they don't match, the rotation didn't deploy correctly — route to `/infra-rotate-secret`.

**2. Escaping clobber in the Ansible template.**
`env.j2` uses `replace('$', '$$')` to double `$` so compose halves it back. If the round-trip dropped a `$`, the `printenv` ground truth won't match the provider. Pragmatic fix: rotate to an alphanumeric-only secret.

**3. Body mutated before signature check.**
Rare. Suspect after the first two are ruled out — usually means someone added middleware that re-encodes JSON.

### Step 2 — Caddy

```bash
ssh deploy@<host> "cd /opt/<app> && docker compose logs --since 5m --timestamps caddy | grep -i webhooks"
```

Caddy is the cheap proof of ingress. If Caddy shows the request but Core doesn't log anything, **that is the normal happy path** (the success path is often silent). Walk to step 4 to confirm.

### Step 3 — Core

```bash
ssh deploy@<host> "cd /opt/<app> && docker compose logs --since 5m --timestamps core | grep -iE 'webhook|<app>|brain|error'"
```

Always pass `--timestamps`. Core stdout has no native timestamp prefix.

### Step 4 — DB

For a typical webhook-driven Nucleus app (example uses a `signals` table), the relevant query is:

```sql
SELECT id, source, kind, references, project_id, created_at
FROM signals
ORDER BY created_at DESC
LIMIT 10;
```

If the expected row is missing despite a 200 from step 1, the handler swallowed an internal error. Look for `[demoapp] perceiveSignal failed:` or equivalent.

---

## Health endpoints

```bash
curl https://<domain>/api/health
# Expected: {"status":"ok","uptime":<sec>,"database":{"connected":true,"latencyMs":<n>}}
```

Webhook signature smoke test (does not require provider):

```bash
# Slack URL verification echo
curl -sS -X POST https://<domain>/api/webhooks/slack \
  -H 'Content-Type: application/json' \
  -d '{"type":"url_verification","challenge":"ping123"}'
# Expected: {"challenge":"ping123"}
```

---

## Read-only DB queries

```bash
/infra-prod-triage db "SELECT count(*) FROM signals WHERE created_at > NOW() - INTERVAL '1 hour'"
```

The kit's `stack triage prod db` wrapper:
1. Opens an SSH tunnel `localhost:5499 → VPS 127.0.0.1:5432`.
2. Decrypts `vault_postgres_password` for the connection string (or prompts for the vault pass).
3. Runs the query.
4. Closes the tunnel.

Read-only only — destructive queries are blocked unless the user types `"yes mutate prod"` (Commandment Three).

For exploratory work, open a DBeaver SSH-tunnel connection instead (see `sop/connecting_to_production_db.md`).

---

## TLS / Caddy diagnostics

```bash
ssh deploy@<host> "cd /opt/<app> && docker compose logs --tail 200 --timestamps caddy" | grep -iE 'cert|tls|acme|error'
```

Common failure modes:

| Symptom | Cause | Fix |
|---|---|---|
| Browser shows certificate error | DNS not resolved to VPS, or LE rate-limited | `dig <domain> +short` → check IP; LE rate-limit page if recently retried |
| Caddy logs `obtain certificate failed` | DNS still wrong, or port 80 blocked (firewall) | Check UFW: `ssh ... sudo ufw status` |
| Caddy logs `certificate expired` | LE renewal failed silently | `docker compose restart caddy` first; if persists, check `caddy_data` volume disk |
| 502 Bad Gateway from Caddy | Core container down | Step 3 (core logs); if crashloop, `docker compose logs core` for boot error |

---

## Disk pressure

```bash
ssh deploy@<host> "df -h /var/lib/docker /opt/<app>"
ssh deploy@<host> "docker system df"
```

If `/var/lib/docker` is >85%, the build cache is the usual culprit. Safe cleanup:

```bash
# Declared blast radius: deletes dangling images and stopped containers' filesystems.
# Does NOT touch running containers, named volumes, or images currently in use.
ssh deploy@<host> "docker container prune -f && docker image prune -f"
```

Never run `docker system prune -a` without explicit "yes prune everything" (Commandment Three).

---

## Deploy verdict

```bash
gh run list --workflow=deploy.yml --limit 5 -R <owner>/<repo>
gh run view <id> -R <owner>/<repo>
```

If the latest deploy is red, read the failing step's logs. Common modes:

| Step | Failure | Fix |
|---|---|---|
| `Build and push Core image` | `pnpm install` failed | Check `.npmrc` and `GITHUB_TOKEN`; remember the dummy-token trap (see CLAUDE.md memory) |
| `Sync infrastructure files` | scp permission | `VPS_SSH_KEY` rotated? Check the deploy user's `~/.ssh/authorized_keys` |
| `Deploy to VPS` | `docker compose pull` failed | GHCR auth on the VPS — check `~/.docker/config.json` for the `deploy` user; re-do `vault_ghcr_token` rotation if needed |
| `Run database migrations` | drizzle-kit error | Read the migration SQL; if structural, route to archie for a fix |

---

## Restart paths (least → most destructive)

| Goal | Command | Effect |
|---|---|---|
| Re-read logs after a transient blip | (nothing, just `logs --since 5m`) | No state change |
| Container is wedged but env is fine | `docker compose restart core` | Process restart, same container |
| Re-pull image without code change | `docker compose pull core && docker compose up -d core` | Picks up a re-tagged image |
| Re-read env after a vault edit | `docker compose up -d --force-recreate core` | New container, same image, fresh env |
| Pin a specific commit (rollback) | Edit `docker-compose.yml` `:latest` → `:<sha>`, then `up -d core` | Image rollback |
| Full restart (Core + Caddy + Postgres) | `docker compose restart` | Brief offline window; do NOT use casually |

Always declare blast radius before any restart.

---

## What this skill does NOT do

- ❌ Execute **any** remote command. No `ssh`, no `scp`, no SSH tunnel, no `gh api` writes. The agent prints; the user runs. (Commandment Four.)
- ❌ Open a psql session against prod, even read-only. The agent prints the tunnel + psql commands; the user opens the session and pastes results.
- ❌ Run `docker system prune` or `docker volume rm` — and the unlock phrase from Commandment Five is moot here, since the agent isn't running remote commands at all right now.
- ❌ Apply Drizzle migrations on prod (CI does it; manual is for emergencies and the user runs it).
- ❌ Modify `/opt/<app>/.env` directly (Ansible is the only path; the user runs the playbook).
- ❌ Push or tag deploys (the user does that).

---

## Self-check

- [ ] Did I start at source of truth #1 (provider UI)?
- [ ] Did I walk the ladder in order, stopping at the failing layer?
- [ ] Did I declare blast radius before any mutation?
- [ ] Did I verify (state-after) with the same probes I used to diagnose?
- [ ] Did I update `infra/_kit/AGENT.md` field notes if the symptom was novel?
