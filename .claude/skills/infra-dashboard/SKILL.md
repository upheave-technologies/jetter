---
name: infra-dashboard
description: "Start, focus, query, or stop the cross-project Stack dashboard at http://localhost:42137. The dashboard reads ~/.stack/registry.json and reports every running instance across every project + worktree on the machine — service, port, health, profile, uptime. Invoke when the user asks 'what's running?', 'show me the dashboard', or 'is X up?'."
---

# /infra-dashboard — The Cross-Project Tracker

You operate `http://localhost:42137` — the single pane of glass across every stack-managed instance on this machine. The dashboard is a tiny standalone Node script with zero npm dependencies. It reads `~/.stack/registry.json` and renders the truth.

---

## Invocation

| Command | Action |
|---|---|
| `/infra-dashboard` | Start (if not running) and open in browser |
| `/infra-dashboard status` | Is the dashboard running? on what port? |
| `/infra-dashboard json` | Output the dashboard's current state as JSON (for piping/agents) |
| `/infra-dashboard restart` | Restart the dashboard process |
| `/infra-dashboard stop` | Stop the dashboard process |
| `/infra-dashboard install` | Install the dashboard as a launchd / systemd unit (auto-start on login) |

---

## What the dashboard shows

```
Stack Dashboard — localhost:42137
================================================================

PROJECT       WORKTREE  PROFILE   PORTS                     HEALTH  UPTIME   TAGS
demoapp         main      full      core:4123 db:5567 :9234   ✅ up   2h 14m   
demoapp         fix-ui    full      core:4127 db:5571 :9238   ✅ up   34m      
demoapp         test-x    minimal   db:5573                   ✅ up   8m       🧪 ephemeral
cerebro       main      cloud     core:4231 db:5601         ✅ up   1d 4h    
landing       main      cloud     core:4233                 ⚠️ unreachable    
================================================================
Stale entries garbage-collected: 0
Last refresh: 2026-05-18 14:32:00
```

Each row corresponds to an `~/.stack/registry.json` entry. The dashboard:
- Reads the registry file on every `/api/state` request.
- Probes each registered port with a TCP connect (timeout 500ms) — that's the health check.
- Marks `🧪 ephemeral` instances (AI test runs).
- Marks `⚠️ unreachable` when ports are bound but the instance metadata says it should be at a different one (drift).
- Marks `❌ down` when the registry has the instance but no ports are bound.

---

## The data model

`~/.stack/registry.json`:

```json
{
  "version": 1,
  "instances": [
    {
      "id": "demoapp-main",
      "project": "demoapp",
      "worktree": "main",
      "path": "/Users/you/code/demoapp",
      "profile": "full",
      "compose_project": "demoapp_main",
      "ephemeral": false,
      "ports": { "core": 4123, "postgres": 5567, "caddy_https": 9234 },
      "urls": [
        "https://your-app.localhost",
        "http://localhost:4123"
      ],
      "started_at": "2026-05-18T12:18:00Z"
    }
  ]
}
```

`stack up` writes / updates one entry; `stack down` removes it; `stack down --volumes` removes it and tags the removal.

---

## Endpoints (machine-readable)

The dashboard speaks HTTP. Anyone (including other AI agents) can call:

| Method | Path | Returns |
|---|---|---|
| GET | `/` | The HTML view |
| GET | `/api/state` | Full state JSON (registry + live probes) |
| GET | `/api/instances` | Instances only |
| GET | `/api/instances/:id` | One instance |
| GET | `/api/health` | Dashboard's own health (`{ ok: true, instances: N, port: 42137 }`) |
| POST | `/api/refresh` | Force a probe refresh (otherwise probes are cached for 3s) |

There is **no mutation API** — the dashboard is read-only. To change state, run `stack` commands.

---

## Common usage

### "What's running?"

```bash
/infra-dashboard
# → opens browser to localhost:42137
```

Or for a one-shot JSON answer:

```bash
/infra-dashboard json
# → prints the JSON state
```

### "Is demoapp-main up?"

```bash
curl -s http://localhost:42137/api/instances/demoapp-main | jq
```

### "How many instances are running?"

```bash
curl -s http://localhost:42137/api/health | jq .instances
```

### "Clean up dead entries"

```bash
infra/_kit/bin/stack doctor --gc
# Same as /infra-port-doctor gc — removes stale registry entries
```

---

## Start / stop / install-as-service

```bash
/infra-dashboard          # spawns the dashboard if not running, opens browser
/infra-dashboard stop     # kills the process (PID in ~/.stack/run/dashboard.pid)
/infra-dashboard install  # installs a launchd plist (macOS) or systemd user unit (Linux) so it auto-starts
```

The install is optional — most users just let `stack up` lazy-start the dashboard. But if you want "always-on" behavior, install the service.

---

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `localhost:42137` won't load | Dashboard not running | `/infra-dashboard` |
| Dashboard runs but shows nothing | `~/.stack/registry.json` empty | Run `stack up` in a project |
| Dashboard shows instances that are gone | Stale registry entries | `/infra-port-doctor gc` |
| Dashboard health check is slow (>3s) | Probe timeouts on dead ports | The dashboard caches probes for 3s; if it's still slow, run `gc` |
| Dashboard port 42137 in use by something else | Port collision | Set `STACK_DASHBOARD_PORT=5556` in `~/.stack/config` and restart |

---

## What this skill does NOT do

- ❌ Provide a UI to start/stop instances. The dashboard is read-only. Mutations go through `stack`.
- ❌ Show production state. The dashboard is local-machine only — it does not poll remote VPSes or Vercel.
- ❌ Authenticate. The dashboard binds to `127.0.0.1` only. Do not bind it to `0.0.0.0`.

---

## Self-check

- [ ] Is the dashboard listening on `127.0.0.1:42137` (or the user's configured port)?
- [ ] Does `/api/health` return `ok: true`?
- [ ] Does the registry's instance count match `docker compose ls` (compose project names matching the registry)?
- [ ] If drift exists, did I run gc?
