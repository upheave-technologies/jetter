#!/usr/bin/env bash
# =============================================================================
# state.sh — Registry writer for ~/.stack/registry.json
# =============================================================================
# Maintains the cross-project instance registry the dashboard reads from.
# Idempotent: registering the same id twice updates the existing row.
# =============================================================================

[[ -n "${_STACK_STATE_LOADED:-}" ]] && return 0
_STACK_STATE_LOADED=1

# shellcheck source=./_common.sh
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

# Register or update an instance.
# Args:
#   id, project, worktree, path, profile, compose_project,
#   app_port, db_port, https_port, ephemeral(0/1), urls(comma-separated)
stack_state_register() {
  local id=$1 project=$2 worktree=$3 path=$4 profile=$5 compose_project=$6
  local app_port=$7 db_port=$8 https_port=$9 ephemeral=${10} urls=${11}

  python3 - <<PY
import json, sys
from datetime import datetime, timezone
file = "$STACK_REGISTRY"
instance = {
    "id": "$id",
    "project": "$project",
    "worktree": "$worktree",
    "path": "$path",
    "profile": "$profile",
    "compose_project": "$compose_project",
    "ephemeral": bool(int("$ephemeral")),
    "ports": {
        "app": int("$app_port"),
        "db": int("$db_port"),
        "proxy_https": int("$https_port") if "$https_port".isdigit() else None,
    },
    "urls": [u for u in "$urls".split(",") if u],
    "started_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
}
try:
    with open(file) as f: data = json.load(f)
except Exception:
    data = {"version": 1, "instances": []}
# Replace existing by id, else append.
others = [i for i in data.get("instances", []) if i.get("id") != "$id"]
data["instances"] = others + [instance]
with open(file, "w") as f:
    json.dump(data, f, indent=2)
PY
}

# Remove an instance by id.
stack_state_unregister() {
  local id=$1
  python3 - <<PY
import json, sys
file = "$STACK_REGISTRY"
try:
    with open(file) as f: data = json.load(f)
except Exception:
    sys.exit(0)
data["instances"] = [i for i in data.get("instances", []) if i.get("id") != "$id"]
with open(file, "w") as f:
    json.dump(data, f, indent=2)
PY
}

stack_state_list() {
  python3 - <<'PY'
import json, os
file = os.path.expanduser("~/.stack/registry.json")
try:
    with open(file) as f: data = json.load(f)
except Exception:
    print("(no instances registered)")
    raise SystemExit(0)
ins = data.get("instances", [])
if not ins:
    print("(no instances registered)")
    raise SystemExit(0)
for i in ins:
    ports = i.get("ports", {})
    bits = " ".join(f"{k}:{v}" for k, v in ports.items() if v)
    tags = "🧪 ephemeral" if i.get("ephemeral") else ""
    print(f"  {i['id']:<32} {i['profile']:<10} {bits:<40} {tags}")
PY
}

stack_state_path() { printf "%s" "$STACK_REGISTRY"; }
