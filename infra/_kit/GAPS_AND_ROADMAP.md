# Gaps & Roadmap — Nucleus Stack Kit

A living list of what's wired, what's planned, and what's deferred. Every time you fix something the kit didn't predict, add a row here.

---

## What's wired today (v0.1.0)

| Capability | Status | Where |
|---|---|---|
| Cross-project uniform CLI (`stack` command) | ✅ done | `bin/stack` |
| Deterministic per-worktree port allocator | ✅ done | `lib/ports.sh` |
| Cross-project dashboard at localhost:42137 | ✅ done | `bin/stack-dashboard` |
| `stack up/down/restart/ps/ports/logs/psql/exec/reset` | ✅ done | `bin/stack` |
| `stack seed list/apply/inspect/new/reset` | ✅ done | `lib/seed.sh` + `seeds/` |
| `stack doctor` (env + tool + manifest sanity, incl. mkcert + cert expiry) | ✅ done | `lib/doctor.sh` |
| `stack tunnel` (ngrok / cloudflared / portless) | ✅ done | `bin/stack` |
| `stack tls install/status/renew/uninstall` — mkcert-based local HTTPS | ✅ done | `lib/tls.sh`, `bin/stack` |
| Cross-platform TLS doc (CA / mkcert / troubleshooting) | ✅ done | `infra/_kit/TLS.md` |
| Manifest-driven lifecycle hooks (`lifecycle.post_up` / `pre_down`) | ✅ done | `lib/lifecycle.sh`, `bin/stack`, `AGENT.md §5.8` |
| `stack up` auto-bootstraps the data layer (migrate + seed) | ✅ done | Hooks declared in the project's `manifest.yaml` |
| Shell integration — `stack` from any subdirectory of any kit-equipped repo | ✅ done | `shell-integration.sh`, `stack install-shell`, `AGENT.md §3.0` |
| Agent commandment: never modify local machine config files without explicit confirmation | ✅ done | `infra.md` Commandment Three |
| `stack sandbox` — ad-hoc isolated stacks with TTL + GC | ✅ done | `lib/sandbox.sh`, `bin/stack`, `AGENT.md §5.7` |
| Sandbox parallel isolation (no host ports) | ✅ done | per-instance compose override `~/.stack/run/sandbox-<id>.compose.yml` clears all `ports:` |
| Sandbox auto-cleanup (TTL + lazy GC + concurrent cap) | ✅ done | `stack_sandbox_gc` runs at top of every `stack` command |
| `stack triage prod` (VPS: ps/logs/psql/tunnel/health/disk/deploy) | ✅ done | `lib/prod.sh` |
| `infra` agent with FAANG-grade routing matrix | ✅ done | `.claude/agents/infra.md` |
| 8 specialized skills | ✅ done | `.claude/skills/infra*/` |
| Idempotent seed scenarios with `@verifies` contract | ✅ done | `seeds/README.md` |
| Ad-hoc isolated stacks for AI flows (now: `stack sandbox`) | ✅ done — superseded by sandboxes | `bin/stack`, `lib/sandbox.sh` |
| Manifest-driven (one YAML drives the whole kit) | ✅ done | `manifest.yaml` |
| Bootstrap into new projects (`/infra-bootstrap`) | ✅ partial | skill written; templates wired; integration testing pending |

---

## Wishlist — gaps Mario named that need explicit work

### G1 — Auto-generated port-aware compose files

**What:** The kit currently generates a `infra/.compose.override.yml` that remaps `4100 → ${STACK_PORT_APP}` and `5432 → ${STACK_PORT_DB}`. This works for the standard VPS shape but assumes specific internal ports.

**Gap:** Projects with non-4100 internal ports (e.g., `app` on `3000`) need a way to declare their internal ports in `manifest.yaml` so the override picks them up.

**Fix:** Add `services.app.internal_port`, `services.db.internal_port`, `services.proxy.internal_port` to manifest. Use them in `stack_compose_port_override`.

**Severity:** Medium. Workaround is to hardcode the override per project.

### G2 — Portless integration (`portless run`-aware mode)

**What:** The kit's `stack tunnel portless` invokes the user's portless setup but doesn't manage portless aliases for stable URLs.

**Gap:** Mario asked for `https://your-app.localhost` as a stable URL across worktrees. Today the kit gives `http://localhost:<port>`. Portless can provide the nice URL but the kit doesn't drive it.

**Fix:** When `features.portless: true` in manifest and `portless` is on PATH:
1. On `stack up`, run `portless alias <slug> <STACK_PORT_APP>` (per-worktree: `portless alias <branch>.<slug> <port>`).
2. On `stack down`, `portless alias --remove <slug>` (or the worktree variant).
3. Register the portless URL in `urls` field of the instance entry so the dashboard surfaces it.

**Severity:** Low. Portless is pre-1.0 and Mario said optional.

### G3 — Cloud profile bootstrap (Vercel + Neon flows)

**What:** `/infra-bootstrap --profile cloud` is documented in the skill but the actual install path is light.

**Gap:** Cloud projects need:
- `vercel link` integration during bootstrap (or honest manual steps)
- Neon branch convention (one branch per preview deploy) wired into the `.github/workflows/preview.yml`
- `stack triage cloud` deeper than today's stub (`vercel ls` + `neonctl projects list`)

**Fix:** Build out the cloud profile end-to-end after the first cloud Nucleus project starts. Right now no project uses this profile so the spec is intentionally light.

**Severity:** Medium for future projects. Zero impact today.

### G4 — Hybrid profile (Vercel main + VPS microservice)

**What:** Mentioned as a configuration option but not implemented.

**Gap:** No real project has this shape yet. When one does, the kit needs:
- Two compose files registered (one for the local microservice)
- The dashboard differentiating which deployment target a route belongs to
- Triage that knows when to walk the Vercel path vs the VPS path

**Severity:** Low until a project asks for it.

### G5 — Read-only DB role in prod

**What:** The `connecting_to_production_db.md` SOP explicitly notes "everyone connects as the `demoapp` superuser, which makes it very easy to `UPDATE` something you meant to `SELECT`."

**Gap:** The kit could provision a `<slug>_readonly` role during `ansible-playbook provision.yml` and `stack triage prod psql` could connect with that role by default.

**Fix:**
1. Add an Ansible task that creates the readonly role on the prod DB (idempotent: `CREATE ROLE IF NOT EXISTS`).
2. Add `vault_<slug>_readonly_password` to the vault.
3. `stack triage prod psql` connects as readonly by default; mutating connections require `STACK_PROD_MUTATE=1` AND the unlock phrase.

**Severity:** High. The current "be careful" model has obvious failure modes.

### G6 — Audit log for prod DB / log access

**What:** SOPs note "there is no audit log of DB queries" and "no log retention guarantee."

**Gap:** `stack triage prod *` operations should write to `~/.stack/prod-access-log.jsonl` (locally) and ideally also to a remote log shipper (Axiom.co / BetterStack / similar).

**Fix (phase 1, local-only):** Wrap every `stack_prod_*` function to append `{ts, project, host, command, exit_code}` to the local log.

**Fix (phase 2):** Ship to a hosted log aggregator. Add `vault_log_shipper_token` to the vault and configure the wrapper.

**Severity:** Medium. Useful for post-incident forensics.

### G7 — Webhook delivery aggregator

**What:** SOPs note "no webhook delivery aggregator yet" and `apps/core/app/admin/webhooks/triage` is a manual UI built on top of the DB.

**Gap:** The kit could ship a `stack webhooks tail` command that reads `webhook_deliveries` (or whatever table) and streams recent activity per provider.

**Severity:** Low. Project-specific.

### G8 — Auto-rotate reminder

**What:** `/infra-rotate-secret` logs rotations to `~/.stack/rotation-log.jsonl`. The kit could surface "last rotated >180 days ago" warnings on `stack doctor`.

**Fix:** Add `stack_doctor` checks that read the rotation log and warn for old entries.

**Severity:** Low.

### G9 — Drift detection between manifest and actual

**What:** Today the kit trusts the manifest. If a project's compose file gets renamed or a service is removed, the kit will fail on `stack up`.

**Gap:** `stack doctor` could deep-validate the manifest by parsing compose files and confirming declared services exist.

**Fix:** Extend `stack_doctor` to load the compose YAML and check `services.<svc_app>`, `services.<svc_db>`, etc. exist.

**Severity:** Medium for kit hygiene.

### G10 — Worktree branch with `/` in it

**What:** Branch names like `feat/foo/bar` are normalised to `feat-foo-bar` in compose project names. Good.

**Gap:** The port-allocator key includes the branch (`<slug>@feat-foo-bar`). On macOS this is fine. On case-insensitive filesystems and certain locales, the SHA may differ trivially. Not yet a real problem.

**Severity:** Watch.

### G11 — `stack triage prod psql` write-mode

**What:** Today the kit refuses write SQL unless `STACK_PROD_MUTATE=1` is set. The unlock phrase is documented but not enforced.

**Fix:** Make the unlock phrase a hard requirement (interactive prompt) for any write SQL, even with the env var set. The env var alone is too easy to slip into a shell rc.

**Severity:** High. Prevents accidental destructive prod SQL.

### G12 — Hardcoded internal container ports in `stack_bound_port`

**What:** `bin/stack` calls `stack_bound_port "$profile" "$svc_app" 4100` (and `5432` for db, `443` for proxy) — the standard Nucleus internal ports. Projects whose service listens on a non-standard internal port (e.g., jet's Next.js on **3000**) silently land in `~/.stack/registry.json` with `ports: {app: 0, db: 0, proxy_https: 0}`. The dashboard then can't probe them, shows `health: unknown`, and `urls:` stays empty. Functional behaviour is fine — the allocator-allocated host port is bound correctly and `curl localhost:<host-port>` returns 200 — but operator visibility breaks.

**Evidence:** As of 2026-06-08 both `aimdall-main` and `jet-jet` exhibit this. aimdall has `app=0`; jet has `app=0 db=0 proxy_https=0`.

**Fix:** Make internal ports manifest-configurable, e.g.:
```yaml
services:
  app: board
  app_internal_port: 3000      # default 4100
  db_internal_port: 5432
  proxy_internal_port: 443
```
Then change the three `stack_bound_port` call sites in `bin/stack` to read from manifest with the current hardcoded values as defaults. Idempotent and backwards-compatible.

**Severity:** Medium. Doesn't break anything — but the dashboard is supposed to be the truth (Commandment Twelve), and right now it's silently wrong for any project that diverges from the Nucleus internal-port convention.

---

## Larger initiatives (not gaps — future direction)

### F1 — Real observability stack

Hosted log shipping (Axiom.co or BetterStack), metrics (Grafana Cloud or similar), alerting. The current "ssh + grep" model is fine for one project; it stops scaling at three.

### F2 — Multi-VPS support

Today the kit assumes one VPS per project. Some future projects may want HA — two VPSes behind a load balancer. The Ansible inventory already supports this shape; the kit's triage commands need to be updated to operate against a list of hosts, not one.

### F3 — Secrets manager migration

When team size grows, Ansible vault + per-laptop key model breaks. Migrate to HashiCorp Vault, AWS SSM Parameter Store, or Doppler. The kit's `infra-rotate-secret` skill is the right abstraction — replace the underlying storage but keep the ritual.

### F4 — Production-grade ephemeral envs

Currently `stack sandbox` is local-only. The big version: spin up a Vercel preview deployment + Neon branch + a test Slack workspace, run a scenario, tear down. Future Mario will want this when the AI fleet outgrows local Docker.

### F5 — Nucleus distribution

Today the kit lives at `infra/_kit/` and `.claude/{agents,skills}/infra*` in each project, manually copied. The end-state: nucleus manifest entries for each kit component, `nucleus update` syncs them globally, projects opt-in by setting `infra-kit: true` in their nucleus preset.

---

## Field notes (incident log)

Append a row each time something surprised you. The format is intentionally light — date, situation, what worked, what to do differently.

| Date | Project | Situation | What we did | What to do differently |
|---|---|---|---|---|
| — | — | — | — | — |

(Initial kit install — no field notes yet. Future Mario, populate this.)
