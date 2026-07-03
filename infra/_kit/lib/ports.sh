#!/usr/bin/env bash
# =============================================================================
# ports.sh — Deterministic port allocator for the Nucleus Stack Kit
# =============================================================================
# Allocates a port range per (project_slug, worktree_branch). Persists the
# allocation in ~/.stack/port-registry.json so re-runs are idempotent.
#
# The algorithm:
#   1. key = "<slug>@<worktree>"
#   2. If registry has key, return cached allocation.
#   3. Else compute base port from sha256(key) modulo range, linear-probe forward
#      until free (per `lsof`), record, return.
#
# Free = no LISTEN on the port AND no other allocation in our registry maps to it.
# =============================================================================

[[ -n "${_STACK_PORTS_LOADED:-}" ]] && return 0
_STACK_PORTS_LOADED=1

# shellcheck source=./_common.sh
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

stack_port_listening() {
  local port=$1
  # lsof is preinstalled on macOS; on Linux it may need apt install lsof.
  # We accept "port in use" as a strong signal — false positives are fine for our purpose.
  if stack_have lsof; then
    lsof -i ":$port" -sTCP:LISTEN -P -n >/dev/null 2>&1
  elif stack_have ss; then
    ss -ltn "sport = :$port" 2>/dev/null | grep -q LISTEN
  else
    # No tool — assume port is free (the OS will fail the bind cleanly if not).
    return 1
  fi
}

stack_port_taken_in_registry() {
  # Returns 0 if the port is allocated to ANY other key in our registry.
  local port=$1 our_key=$2
  python3 - "$STACK_PORT_REGISTRY" "$port" "$our_key" <<'PY' 2>/dev/null
import json, sys
file, port, our_key = sys.argv[1], int(sys.argv[2]), sys.argv[3]
try:
    with open(file) as f:
        data = json.load(f)
except Exception:
    sys.exit(1)
for k, ports in data.get("allocations", {}).items():
    if k == our_key:
        continue
    for v in ports.values():
        if int(v) == port:
            sys.exit(0)
sys.exit(1)
PY
}

# Compute a candidate port from a hashed string, modulo a range.
stack_hash_port() {
  local input=$1 base=$2 range=$3
  local hash
  hash=$(stack_sha256 "$input")
  # Take first 8 hex chars → 32 bits → modulo range
  local n=$(( 16#${hash:0:8} % range ))
  printf "%d" $(( base + n ))
}

# Allocate one port within a range, probing forward.
# Args: key role base range
# Returns the chosen port via stdout.
stack_allocate_port() {
  local key=$1 role=$2 base=$3 range=$4
  local candidate
  candidate=$(stack_hash_port "${key}:${role}" "$base" "$range")
  local end=$(( base + range ))
  local probes=0
  while (( probes < range )); do
    if ! stack_port_listening "$candidate" && ! stack_port_taken_in_registry "$candidate" "$key"; then
      printf "%d" "$candidate"
      return 0
    fi
    candidate=$(( candidate + 1 ))
    if (( candidate >= end )); then candidate=$base; fi
    probes=$(( probes + 1 ))
  done
  stack_die "no free port in range $base-$(( end - 1 )) for $key:$role"
  return 1
}

# Read the cached allocation for a key, or empty.
stack_read_alloc() {
  local key=$1
  python3 - "$STACK_PORT_REGISTRY" "$key" <<'PY' 2>/dev/null
import json, sys
file, key = sys.argv[1], sys.argv[2]
try:
    with open(file) as f:
        data = json.load(f)
except Exception:
    sys.exit(1)
alloc = data.get("allocations", {}).get(key)
if not alloc:
    sys.exit(1)
print(json.dumps(alloc))
PY
}

# Write an allocation for a key (overwrites previous).
stack_write_alloc() {
  local key=$1 ports_json=$2  # ports_json: e.g. '{"app":4123,"db":5567,"proxy_https":9234}'
  python3 - "$STACK_PORT_REGISTRY" "$key" "$ports_json" <<'PY'
import json, sys
file, key, ports = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
try:
    with open(file) as f:
        data = json.load(f)
except Exception:
    data = {"version": 1, "allocations": {}}
data.setdefault("allocations", {})[key] = ports
with open(file, "w") as f:
    json.dump(data, f, indent=2)
PY
}

# Forget an allocation (used by `stack down --release-ports` or `port-doctor gc`).
stack_forget_alloc() {
  local key=$1
  python3 - "$STACK_PORT_REGISTRY" "$key" <<'PY'
import json, sys
file, key = sys.argv[1], sys.argv[2]
try:
    with open(file) as f:
        data = json.load(f)
except Exception:
    sys.exit(0)
data.get("allocations", {}).pop(key, None)
with open(file, "w") as f:
    json.dump(data, f, indent=2)
PY
}

# Main entry — ensure an allocation exists for the current worktree.
# Outputs `KEY=VALUE` lines suitable for `eval "$(stack_ensure_ports)"` or for
# writing to infra/.ports.
stack_ensure_ports() {
  local slug worktree key
  slug=$(stack_project_slug)
  worktree=$(stack_current_worktree)
  key="${slug}@${worktree}"

  # Optional --ephemeral suffix
  if [[ "${STACK_EPHEMERAL:-0}" == "1" ]]; then
    local suffix
    suffix=$(stack_sha256 "$(date +%s%N)$$" | cut -c1-6)
    key="${key}#${suffix}"
  fi

  local cached
  cached=$(stack_read_alloc "$key" 2>/dev/null || true)

  local app_port db_port proxy_https_port proxy_http_port

  if [[ -n "$cached" ]]; then
    # Re-use cached allocation.
    app_port=$(printf "%s" "$cached"        | python3 -c "import sys,json;print(json.load(sys.stdin).get('app',''))")
    db_port=$(printf "%s" "$cached"         | python3 -c "import sys,json;print(json.load(sys.stdin).get('db',''))")
    proxy_https_port=$(printf "%s" "$cached" | python3 -c "import sys,json;print(json.load(sys.stdin).get('proxy_https',''))")
    proxy_http_port=$(printf "%s" "$cached"  | python3 -c "import sys,json;print(json.load(sys.stdin).get('proxy_http',''))")
  else
    # Fresh allocation.
    local app_base app_range db_base db_range pxs_base pxs_range pxh_base pxh_range
    app_base=$(stack_manifest ports.app.base 4000)
    app_range=$(stack_manifest ports.app.range 500)
    db_base=$(stack_manifest ports.db.base 5500)
    db_range=$(stack_manifest ports.db.range 300)
    pxs_base=$(stack_manifest ports.proxy_https.base 9000)
    pxs_range=$(stack_manifest ports.proxy_https.range 800)
    pxh_base=$(stack_manifest ports.proxy_http.base 8000)
    pxh_range=$(stack_manifest ports.proxy_http.range 800)

    app_port=$(stack_allocate_port "$key" app "$app_base" "$app_range")
    db_port=$(stack_allocate_port "$key" db "$db_base" "$db_range")
    proxy_https_port=$(stack_allocate_port "$key" proxy_https "$pxs_base" "$pxs_range")
    proxy_http_port=$(stack_allocate_port "$key" proxy_http "$pxh_base" "$pxh_range")

    stack_write_alloc "$key" "$(printf '{"app":%d,"db":%d,"proxy_https":%d,"proxy_http":%d}' \
      "$app_port" "$db_port" "$proxy_https_port" "$proxy_http_port")"
  fi

  # Write infra/.ports for inspectability and compose's env_file consumption.
  local ports_file="$STACK_REPO_ROOT/infra/.ports"
  cat >"$ports_file" <<EOF
# Generated by Nucleus Stack Kit — do not edit by hand.
# Worktree: $key
STACK_KEY=$key
STACK_PORT_APP=$app_port
STACK_PORT_DB=$db_port
STACK_PORT_PROXY_HTTPS=$proxy_https_port
STACK_PORT_PROXY_HTTP=$proxy_http_port
EOF

  # Echo for caller eval-ing.
  printf "STACK_KEY=%s\n" "$key"
  printf "STACK_PORT_APP=%d\n" "$app_port"
  printf "STACK_PORT_DB=%d\n" "$db_port"
  printf "STACK_PORT_PROXY_HTTPS=%d\n" "$proxy_https_port"
  printf "STACK_PORT_PROXY_HTTP=%d\n" "$proxy_http_port"
}

# Garbage-collect entries whose project paths no longer exist.
stack_ports_gc() {
  python3 - "$STACK_PORT_REGISTRY" "$STACK_REGISTRY" <<'PY'
import json, os, sys
port_file, reg_file = sys.argv[1], sys.argv[2]
try:
    with open(port_file) as f: ports = json.load(f)
except Exception: ports = {"version": 1, "allocations": {}}
try:
    with open(reg_file) as f: reg = json.load(f)
except Exception: reg = {"instances": []}

# Build a set of currently-known instance keys.
live_keys = set()
for inst in reg.get("instances", []):
    path = inst.get("path", "")
    if os.path.isdir(path):
        live_keys.add(f"{inst.get('project','')}@{inst.get('worktree','')}")

# Anything in port-registry not in live AND whose path can't be found is stale.
removed = []
for key in list(ports.get("allocations", {}).keys()):
    if key in live_keys:
        continue
    # If we can't determine the path, leave it alone — caller can force-remove with --release-ports.
    removed.append(key)
    del ports["allocations"][key]

with open(port_file, "w") as f:
    json.dump(ports, f, indent=2)

print(f"Removed {len(removed)} stale port allocations.")
for k in removed:
    print(f"  - {k}")
PY
}
