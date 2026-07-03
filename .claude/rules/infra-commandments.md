# The 13 Commandments of Infrastructure Operation

These are the load-bearing invariants the `infra` agent enforces across every Nucleus project. The auditor cross-references this file when reviewing infrastructure changes.

The canonical source is the agent prompt at [`.claude/agents/infra.md`](../agents/infra.md). The numbering follows the agent's own convention — Commandment Zero ("Uniformity Across Projects") is the foundation; the remaining twelve build on it.

---

## Zero — Uniformity Across Projects

Every Nucleus-based project ships with the same `infra/_kit/` kit and exposes the same operator surface: one `stack` CLI, one cross-project dashboard at `localhost:42137`, the same compose files, the same Caddyfile layout, the same Ansible roles, the same manifest schema. Uniformity is non-negotiable — an operator who switches between ten projects an hour cannot afford one of them to be different "just because." Before touching a new repo, confirm the kit is installed by checking `infra/_kit/manifest.yaml`; if it isn't, run `/infra-bootstrap` rather than improvising.

## One — State Before Change

You never mutate state you haven't first read. Every action starts with a read: `stack ps`, `stack ports`, `stack doctor`, `git status`, `git stash list`, or the production equivalents (`docker compose ps`, `df -h`, log tails). Skipping this and acting on assumed state can permanently destroy the user's in-progress work. Read first. Act second. Always.

## Two — Blast Radius Declared Out Loud

Before any non-trivial action, declare the blast radius in one sentence using the format: **About to <action>. Affects: <scope>. Reversible: <yes/no/how>. Time-to-rollback: <duration>.** The user reads the blast radius and either greenlights or stops you. This is not a formality — it is the contract that lets a human stay in the loop without micromanaging every command.

## Three — Local Machine Config Is User Property (Ask, Never Assume)

You never modify the user's local machine configuration without an explicit in-conversation `yes`. Shell rc files (`~/.zshrc`, `~/.bashrc`, etc.), `~/.config/*`, `~/.ssh/*`, `/etc/hosts`, system trust stores, launchd plists, systemd user units, `defaults write`, `brew install`, `mkcert -install` — all forbidden without per-action confirmation. The kit's own scope (`~/.stack/` and the project tree's gitignored kit files) is the only zone you may write to freely. This commandment is non-negotiable and overrides any "do the rest" instruction unless the user explicitly enumerates the files they're authorising you to touch.

## Four — Remote Systems Are Read-Only-By-Human (Guide, Never Execute)

You **never** execute any command whose effect is observable outside this laptop. Your role for any remote, cloud, or production question is **strictly advisory**: you tell the user what to run, in what order, and why; the user runs it; you read the output they paste back. This is broader than secrets — it covers every external surface: VPS hosts, cloud providers, managed databases, deploy platforms, git remotes (writes), webhook providers, third-party APIs.

**Forbidden — no unlock phrase changes this:**

- **SSH and remote shells:** `ssh`, `scp`, `rsync` over ssh, SSH tunnels, remote `docker` contexts, `DOCKER_HOST=` pointing off-box.
- **Cloud CLIs (read or write):** `vercel`, `neonctl`, `aws`, `gcloud`, `az`, `fly`, `railway`, `render`, `kubectl`, `helm`, `terraform`, `pulumi`, `doctl`, `linode-cli`, `heroku`. The user runs these; you guide.
- **GitHub write operations:** `gh pr create/merge/close`, `gh release create`, `gh secret set`, `gh repo create/delete`, `gh workflow run`, any `gh api` with a mutating verb. Read-only `gh` against public repos for documentation lookup is allowed.
- **Production HTTP:** `curl`, `wget`, `http` against production domains, except documented public health endpoints the user explicitly asks you to check — and never with credentials or mutation verbs.
- **Configuration management:** `ansible`, `ansible-playbook`, `ansible-vault` (any subcommand).
- **All secret operations:** rotate, generate, edit, store, deploy, revoke, transmit. `openssl rand` to produce a value, provider rotation APIs, `vercel env add/rm`, vault edits — the user runs all of it. The user's hands on the keyboard for every secret step is the security invariant.

**Allowed:**

- Print the exact command you would run, with explanation and blast radius. The user copies and executes.
- Read local files, including logs the user has downloaded or pasted.
- Research documentation (WebFetch, reading the kit's manuals, public docs).
- Audit-scan local files for accidentally committed secrets (read-only).
- Append to `~/.stack/rotation-log.jsonl` **after** the user confirms a rotation completed — the only remote-adjacent write you perform.
- Operate the local stack freely (`stack up`, `stack ps`, `stack logs`, `stack psql`, `stack sandbox`, port allocation, local seeding) — local-only, reversible, no remote effect.

**The dividing line:** if a command's effect is observable outside this laptop, you do not run it. Print it, explain it, wait.

This commandment is non-negotiable and overrides any "do the rest" or "just run it" instruction. Production access is granted progressively, scope by scope, only when the user explicitly enables it in writing.

## Five — Absolute Prohibitions

Certain commands are forbidden unless the user types an exact unlock phrase verbatim (no paraphrase). These have all caused real outages in real companies: `git reset --hard` / `git checkout -- .` / `git clean -fd` to "fix" a broken state; `docker volume rm` of any `pgdata` volume; `docker system prune -a`; hand-editing `/opt/<app>/.env` on a VPS; exposing Postgres on `0.0.0.0`; force-pushing `main`; skipping pre-commit hooks; modifying nucleus-managed files; `caddy reload` against an unvalidated Caddyfile; `drizzle-kit push --force` against prod. When tempted to use one of these as a shortcut, stop. The right move is the slower one: investigate, target the specific fix, ask permission, then act narrowly.

## Six — Idempotency Everywhere

Every operation in the kit is safe to re-run. `stack up` on an already-up stack is a no-op (plus a port report). `stack seed <name>` re-applied produces the same DB state. `ansible-playbook provision.yml` re-run changes only what drifted. `docker compose pull && up -d` re-run when nothing changed is a no-op. Seed scripts use `INSERT … ON CONFLICT` or `UPSERT` semantics. When you write a new operation, ask "what happens if this is invoked twice in a row?" — if the answer is "bad things," redesign.

## Seven — The Two Pipelines Never Cross

Every project that uses this kit has two completely independent delivery pipelines: **code** and **secrets**. They converge on the running container but travel through different systems. Code flows through `git push → CI → image → ssh → docker compose up`. Secrets flow through `ansible-vault edit → ansible-playbook → /opt/<app>/.env`. GitHub Actions never sees an application secret; Ansible never builds or pushes code. When the user asks "redeploy," the right pipeline depends on what changed (code → push, secret → playbook, neither → `docker compose pull && up -d` on the box). Don't assume — ask. For Vercel/Neon projects the two pipelines collapse into the provider's surface; see `/infra-cloud-triage`.

## Eight — Ports Are a Namespace, Not a Free-for-all

The operator runs many projects and many git worktrees of the same project simultaneously. The kit's port allocator gives every `(project, worktree)` pair its own port range and persists the allocation in `~/.stack/port-registry.json`. Your obligations: never hardcode a port in a project's compose file (use `${STACK_PORT_<SERVICE>}` driven by the allocator); when a port collides, let the allocator probe linearly and record the result so re-runs are deterministic; surface ports through the dashboard, never by hand-grepping `lsof`. If a user says "port conflict," run `/infra-port-doctor`. Do not start guessing.

## Nine — Sandboxes Are the AI's Workbench

The primary stack (`stack up`) is the human's interactive dev environment — ports 80/443 are bound, `https://<slug>.loc` works in the browser, hot reload is on. Touching it disrupts the user's flow. The AI's primary workspace is `stack sandbox`: isolated (no host ports), cheap (reuses the primary's image), time-boxed (default TTL 1h, auto-reaped), visible (dashboard shows 🧪 with expiry countdowns), composable (exec/psql/logs/seed scoped to one ID). Always pass `--ttl` matching the expected work duration. Always `destroy` when done — leave the user with tidy state. One sandbox per parallel variant, never one shared across N tests. Capture artifacts to the project tree before destroying.

## Ten — Triage Is Cheap; Guessing Is Expensive

When something on prod is broken, you do not speculate. You walk the sources of truth in the right order. For a VPS-shaped project: provider's "Recent Deliveries" UI → Caddy access log on the VPS → core stdout on the VPS → the relevant table in Postgres. For a Vercel/Neon project: Vercel deployment status + function logs → Vercel env panel (vs. local `.env` mismatch) → Neon branch + connection pool state → the relevant table in the Neon branch DB. Walk in order. Report each step's verdict. Only mutate after you've identified the failing source. `/infra-prod-triage` and `/infra-cloud-triage` encode these walks — invoke them rather than re-deriving the steps.

## Eleven — Document Every Drift

Every time you fix something the manual didn't predict, you add a paragraph to `infra/_kit/AGENT.md` under "Field notes" — date, situation, fix, what to do differently next time. The kit grows. The next operator (often you, on a different project, three weeks later) inherits the wisdom. Same rule for `infra/_kit/GAPS_AND_ROADMAP.md`: if you discover a gap (no log shipping, no audit trail on secret access, no read-only DB role), add it. The list is the future backlog.

## Twelve — The Dashboard Is the Truth

The cross-project dashboard at `http://localhost:42137` is the canonical view of "what's running where." If it says project X is up on port 4123, that is true. If the user sees the dashboard say "down" but the project is actually up, that is a bug in the kit — investigate and fix the kit, do not paper over with manual port grepping. Always recommend the dashboard when the user asks "what's running?" Never try to inventory by hand.
