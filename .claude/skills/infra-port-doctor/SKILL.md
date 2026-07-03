---
name: infra-port-doctor
description: "Diagnose and resolve local port conflicts across projects and git worktrees. Reads the stack port registry, scans active listeners, identifies the offender, proposes a remediation, and (on confirmation) reallocates. Invoke when the user reports 'port in use', 'address already in use', 'EADDRINUSE', or when stack up fails on a bind."
---

# /infra-port-doctor — Port Conflict Operator

You diagnose port collisions deterministically. Mario runs ten-plus projects, multiple worktrees per project, and the dashboard. Port conflicts are inevitable. Your job is to identify, attribute, and fix them in seconds.

---

## Invocation

| Command | Action |
|---|---|
| `/infra-port-doctor` | Diagnose the current worktree's ports |
| `/infra-port-doctor <port>` | Diagnose a specific port number |
| `/infra-port-doctor all` | Diagnose every entry in `~/.stack/port-registry.json` |
| `/infra-port-doctor reassign` | Reallocate this worktree's ports and write `infra/.ports` |
| `/infra-port-doctor gc` | Garbage-collect stale registry entries (worktrees that no longer exist) |

---

## The mental model

The kit gives every `(project_slug, worktree_branch)` pair its own port range, persisted in `~/.stack/port-registry.json`:

```json
{
  "demoapp@main":     { "core": 4123, "postgres": 5567, "caddy_https": 9234 },
  "demoapp@fix-ui":   { "core": 4127, "postgres": 5571, "caddy_https": 9238 },
  "cerebro@main":   { "core": 4231, "postgres": 5601, "caddy_https": 9301 }
}
```

Allocation algorithm:
1. `hash = sha256(<slug>@<worktree>)`
2. Initial port = `<service_base> + (hash % <service_range>)`
3. If the port is taken (per `lsof` or another registry entry), linear-probe forward until free.
4. The chosen port is written to the registry and to the project's `infra/.ports`.

This means re-running `stack up` on the same worktree always reuses the same port (idempotent). New worktrees never collide with old ones. Other software on the machine (a stray Postgres on 5432, a `node` on 3000) is detected and routed around.

---

## Diagnosis protocol

When invoked without args:

1. Read `infra/.ports` for the current worktree.
2. For each port in the file, run `lsof -i :<port> -sTCP:LISTEN -P -n -F pcfn` to identify what's bound to it.
3. Cross-reference each owner against `~/.stack/port-registry.json` to attribute it to a worktree.
4. Output a table:

```
Worktree: demoapp@main
─────────────────────────────────────────────────────────────────────────
Service        Expected  Bound by                          Verdict
core           4123      docker compose (demoapp_main)       ✅ owned by us
postgres       5567      docker compose (demoapp_main)       ✅ owned by us
caddy_https    9234      (none)                            ⚠️  expected up
─────────────────────────────────────────────────────────────────────────
External listeners on our service ranges:
  5432  postgres.app                                       (system Postgres — unrelated)
  4567  node /Users/mario/code/Labs/other-proj/...         (foreign worktree — not in registry)
```

When invoked with a specific port:

```
Port 4123
─────────────────────────────────────────────
Bound by:    docker compose (demoapp_main)
PID:         34782 (com.docker.backend)
Owner:       demoapp@main (per registry)
Status:      ✅ legitimate
─────────────────────────────────────────────
```

When the owner is **not in the registry**, that's an unmanaged process. Flag it. The user decides whether to kill it or reallocate.

---

## Reassign protocol

```bash
/infra-port-doctor reassign
```

Triggered when a conflict is unresolvable (e.g., another project's compose is holding the port and the user doesn't want to stop it).

1. **Declare blast radius:** "Reallocating ports for demoapp@main. Affects: this worktree's compose project, the dashboard's view, any open psql/curl sessions targeting the old port. Reversible: yes — re-run with `--seed <previous-hash>` or accept new ports."
2. Generate fresh ports by re-hashing with a salt (`<slug>@<worktree>:<rev>`) and probing.
3. Write new ports to `~/.stack/port-registry.json` and `infra/.ports`.
4. If the stack is up, `stack down && stack up` to re-bind.
5. Update the dashboard's view.

---

## Garbage collection

```bash
/infra-port-doctor gc
```

A registry entry is stale if:
- Its project directory no longer exists at the recorded path, OR
- The worktree branch is gone (`git worktree list` doesn't include it), OR
- `lsof` shows nothing on the recorded ports AND `stack ps` returns no matches for the compose project name.

Stale entries are removed from `~/.stack/port-registry.json`. The kit logs each removal so it's traceable.

---

## Edge cases you handle gracefully

| Symptom | Likely cause | Fix |
|---|---|---|
| `bind: address already in use` on `up` | Foreign process on our port | `port-doctor <port>` to identify, then either stop the foreign process or `reassign` |
| Two worktrees of same project hashing to same port | Bug in the allocator — they should not | Stop both, `port-doctor gc`, `port-doctor reassign` on both |
| Dashboard says "down" but `lsof` shows port bound | Compose project name mismatch between registry and reality | `port-doctor gc` + `stack up` re-registers |
| Postgres on 5432 (macOS Postgres.app) conflicting with ours | System Postgres squatting | Either stop it (`pg_ctl -D ... stop`) or accept that the kit will assign 5433+ |
| `lsof` shows port bound but no PID | Container died without releasing | `docker compose rm -f` and re-up |

---

## What this skill does NOT do

- ❌ Kill foreign processes without explicit user confirmation.
- ❌ Modify another project's port assignments.
- ❌ Edit `/etc/hosts` (that's a portless concern, not ours).

---

## Self-check

- [ ] Did I read `~/.stack/port-registry.json` before proposing changes?
- [ ] Did I check `lsof` for every port I claim is in use?
- [ ] Did I cross-reference with `docker compose ls` to confirm ownership?
- [ ] If I reassigned, did I update both the registry AND `infra/.ports`?
- [ ] If I garbage-collected, did I confirm the entries were truly stale?
