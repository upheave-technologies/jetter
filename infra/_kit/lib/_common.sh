#!/usr/bin/env bash
# =============================================================================
# _common.sh — Shared helpers for the Nucleus Stack Kit
# =============================================================================
# Sourced by lib/*.sh and bin/stack. Provides: colored output, manifest reader,
# repo + worktree detection, dependency checks, and the STACK_HOME convention.
#
# Conventions:
#   - All functions are prefixed `omega_` to avoid collision with caller scripts.
#   - Functions print errors to stderr and return non-zero. No `exit` inside libs.
#   - macOS-compatible (no GNU-isms like `readlink -f`, `sha256sum`).
# =============================================================================

# Idempotent guard — sourcing this file twice is a no-op.
[[ -n "${_STACK_COMMON_LOADED:-}" ]] && return 0
_STACK_COMMON_LOADED=1

# -----------------------------------------------------------------------------
# Colors (auto-disabled when stdout isn't a terminal)
# -----------------------------------------------------------------------------
if [[ -t 1 ]] && [[ -z "${NO_COLOR:-}" ]]; then
  C_RESET=$'\033[0m'
  C_DIM=$'\033[2m'
  C_BOLD=$'\033[1m'
  C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'
  C_MAGENTA=$'\033[35m'
  C_CYAN=$'\033[36m'
else
  C_RESET="" C_DIM="" C_BOLD="" C_RED="" C_GREEN="" C_YELLOW="" C_BLUE="" C_MAGENTA="" C_CYAN=""
fi

stack_info()  { printf "%s\n" "${C_DIM}::${C_RESET} $*" >&2; }
stack_ok()    { printf "%s %s\n" "${C_GREEN}✓${C_RESET}" "$*" >&2; }
stack_warn()  { printf "%s %s\n" "${C_YELLOW}⚠${C_RESET}" "$*" >&2; }
stack_err()   { printf "%s %s\n" "${C_RED}✗${C_RESET}" "$*" >&2; }
stack_step()  { printf "\n%s%s%s\n" "${C_BOLD}${C_CYAN}" "▸ $*" "${C_RESET}" >&2; }
stack_die()   { stack_err "$*"; return 1; }
stack_hint()  { printf "  %s→ %s%s\n" "${C_DIM}" "$*" "${C_RESET}" >&2; }

# Print an error with an actionable hint, then return 1.
# Usage:  stack_fail "what failed" "what to do next"
stack_fail() {
  stack_err "$1"
  [[ -n "${2:-}" ]] && stack_hint "$2"
  return 1
}

# -----------------------------------------------------------------------------
# Paths — STACK_HOME is the per-user state directory (~/.stack by default).
# STACK_KIT_DIR is the infra/_kit/ directory of the current project.
# STACK_REPO_ROOT is the project's root.
# -----------------------------------------------------------------------------

# `realpath` portability for macOS (no `readlink -f`).
stack_realpath() {
  local target=$1
  [[ -e "$target" ]] || { printf "%s" "$target"; return; }
  if [[ -d "$target" ]]; then
    (cd "$target" && pwd -P)
  else
    local dir base
    dir=$(cd "$(dirname "$target")" && pwd -P)
    base=$(basename "$target")
    printf "%s/%s" "$dir" "$base"
  fi
}

# Locate the kit directory based on this script's own location.
stack_kit_dir() {
  local self
  self=$(stack_realpath "${BASH_SOURCE[0]}")
  # _common.sh lives at infra/_kit/lib/_common.sh — go up two dirs.
  printf "%s" "$(dirname "$(dirname "$self")")"
}

STACK_KIT_DIR=${STACK_KIT_DIR:-$(stack_kit_dir)}

# Walk up to find the repo root (looks for .git or pnpm-workspace.yaml).
stack_repo_root() {
  local dir=${1:-$STACK_KIT_DIR}
  while [[ "$dir" != "/" ]]; do
    if [[ -d "$dir/.git" ]] || [[ -f "$dir/pnpm-workspace.yaml" ]] || [[ -f "$dir/package.json" ]]; then
      printf "%s" "$dir"; return 0
    fi
    dir=$(dirname "$dir")
  done
  stack_die "could not find repo root from $1"
}

STACK_REPO_ROOT=${STACK_REPO_ROOT:-$(stack_repo_root "$STACK_KIT_DIR")}

# Per-user state dir.
STACK_HOME=${STACK_HOME:-$HOME/.stack}

# Per-user config — sourced (auto-export) before computing dashboard port etc.
# Lets users set STACK_DASHBOARD_PORT, STACK_PROD_HOST, etc. globally without
# editing their shell rc. Example contents of ~/.stack/config:
#   STACK_DASHBOARD_PORT=42137
# All assignments are auto-exported so child processes (stack-dashboard) see them.
if [[ -f "$STACK_HOME/config" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$STACK_HOME/config"
  set +a
fi

STACK_REGISTRY=$STACK_HOME/registry.json
STACK_PORT_REGISTRY=$STACK_HOME/port-registry.json
STACK_SEED_LOG=$STACK_HOME/seed-log.jsonl
STACK_ROTATION_LOG=$STACK_HOME/rotation-log.jsonl
STACK_DASHBOARD_PID=$STACK_HOME/run/dashboard.pid
# Default port avoids common dev-tool conflicts (5555 = Prisma Studio).
STACK_DASHBOARD_PORT=${STACK_DASHBOARD_PORT:-42137}
export STACK_DASHBOARD_PORT
STACK_DASHBOARD_LOG=$STACK_HOME/run/dashboard.log

stack_ensure_home() {
  mkdir -p "$STACK_HOME/run"
  [[ -f "$STACK_REGISTRY" ]] || printf '{"version":1,"instances":[]}\n' > "$STACK_REGISTRY"
  [[ -f "$STACK_PORT_REGISTRY" ]] || printf '{"version":1,"allocations":{}}\n' > "$STACK_PORT_REGISTRY"
  touch "$STACK_SEED_LOG" "$STACK_ROTATION_LOG"
}

# -----------------------------------------------------------------------------
# Worktree detection — same project, multiple checkouts via `git worktree`.
# -----------------------------------------------------------------------------

stack_current_worktree() {
  # If we're inside a git worktree, the branch name is our worktree id.
  # If not (or if HEAD is detached), use the directory's basename as a stable fallback.
  local branch
  if branch=$(git -C "$STACK_REPO_ROOT" symbolic-ref --short HEAD 2>/dev/null); then
    # Normalise: replace `/` with `-` so it's safe in compose project names.
    printf "%s" "${branch//\//-}"
  else
    # Detached HEAD or non-git — use the path's basename.
    basename "$STACK_REPO_ROOT"
  fi
}

# -----------------------------------------------------------------------------
# Manifest reading — minimal YAML reader (sufficient for our shape).
# Usage: stack_manifest <key.path>     e.g. stack_manifest project.slug
# Supports nested keys, scalars, lists (returns joined by newlines).
# Falls back to a default if the key is missing.
# -----------------------------------------------------------------------------

stack_manifest_file() {
  # Prefer the repo-local rendered manifest (infra/_kit/manifest.yaml) so that
  # `bootstrap render` always wins over a stale copy in the kit source tree.
  local repo_local="$STACK_REPO_ROOT/infra/_kit/manifest.yaml"
  if [[ -f "$repo_local" ]]; then
    printf "%s" "$repo_local"
  else
    printf "%s" "$STACK_KIT_DIR/manifest.yaml"
  fi
}

stack_manifest() {
  local key=$1 default=${2:-}
  local file
  file=$(stack_manifest_file)
  [[ -f "$file" ]] || { printf "%s" "$default"; return 0; }

  # Pure-stdlib YAML subset parser — handles the manifest's shape (nested
  # dicts, scalars, comments, inline `{ ... }` dicts). Avoids requiring pyyaml.
  local val
  val=$(python3 - "$file" "$key" <<'PY' 2>/dev/null
import sys, re

file, key = sys.argv[1], sys.argv[2]

def _coerce(v):
    s = v.strip()
    # Strip inline comment. Walk left-to-right tracking quote state so a `#`
    # inside a quoted string isn't treated as a comment.
    out = []
    in_quote = None
    i = 0
    while i < len(s):
        ch = s[i]
        if in_quote:
            if ch == in_quote:
                in_quote = None
            out.append(ch)
        elif ch in ('"', "'"):
            in_quote = ch
            out.append(ch)
        elif ch == '#' and (i == 0 or s[i-1].isspace()):
            break
        else:
            out.append(ch)
        i += 1
    s = ''.join(out).rstrip()
    # Strip surrounding quotes.
    if len(s) >= 2 and ((s[0] == s[-1] == '"') or (s[0] == s[-1] == "'")):
        s = s[1:-1]
    if s in ('null', '~', ''): return None
    if s == 'true':  return True
    if s == 'false': return False
    try: return int(s)
    except ValueError: pass
    try: return float(s)
    except ValueError: pass
    return s

def _parse_flow_dict(s):
    """Parse a single-line flow-style dict like { a: 1, b: 2 }."""
    s = s.strip()
    if not (s.startswith('{') and s.endswith('}')): return None
    inner = s[1:-1].strip()
    if not inner: return {}
    out = {}
    # Split on commas not inside braces (we only handle one level).
    depth = 0; buf = ''; parts = []
    for ch in inner:
        if ch == ',' and depth == 0:
            parts.append(buf); buf = ''
        else:
            if ch == '{': depth += 1
            elif ch == '}': depth -= 1
            buf += ch
    if buf.strip(): parts.append(buf)
    for p in parts:
        if ':' not in p: return None
        k, v = p.split(':', 1)
        out[k.strip()] = _coerce(v)
    return out

# Build a nested dict from the YAML file using indentation.
root = {}
stack = [(-1, root)]  # (indent, dict_at_that_level)

with open(file) as fh:
    for raw in fh:
        # Drop full-line comments + blank lines
        if not raw.strip() or raw.lstrip().startswith('#'):
            continue
        # Compute indent (tabs treated as 2 spaces is fine for our shape; we
        # use 2-space indents in the manifest).
        stripped = raw.lstrip(' ')
        indent = len(raw) - len(stripped)
        line = stripped.rstrip('\n')

        # Pop the stack until the parent is shallower than this line.
        while stack and stack[-1][0] >= indent:
            stack.pop()
        parent = stack[-1][1] if stack else root

        m = re.match(r'^([A-Za-z_][\w-]*)\s*:\s*(.*)$', line)
        if not m: continue
        k, rest = m.group(1), m.group(2)
        rest = rest.rstrip()

        if rest == '':
            # Subtree follows.
            new_dict = {}
            parent[k] = new_dict
            stack.append((indent, new_dict))
        elif rest.startswith('{'):
            d = _parse_flow_dict(rest)
            parent[k] = d if d is not None else _coerce(rest)
        else:
            parent[k] = _coerce(rest)

# Resolve the dotted key.
node = root
for part in key.split('.'):
    if isinstance(node, dict) and part in node:
        node = node[part]
    else:
        sys.exit(1)

if isinstance(node, bool):
    print("true" if node else "false")
elif isinstance(node, (list, tuple)):
    print("\n".join(str(x) for x in node))
elif node is None:
    sys.exit(1)
else:
    print(node)
PY
) || true

  if [[ -z "$val" ]]; then
    printf "%s" "$default"
  else
    printf "%s" "$val"
  fi
}

# Return the child keys of a dict in the manifest, in declaration order.
# Empty if the key is missing or not a dict. Used by the lifecycle runner to
# iterate over named hook steps.
#
# Usage:   stack_manifest_keys lifecycle.post_up
#          → migrate
#            seed_projects
stack_manifest_keys() {
  local key=$1
  local file
  file=$(stack_manifest_file)
  [[ -f "$file" ]] || return 0

  python3 - "$file" "$key" <<'PY' 2>/dev/null
import sys, re

file, key = sys.argv[1], sys.argv[2]

def _coerce(v):
    s = v.strip()
    out = []
    in_quote = None
    i = 0
    while i < len(s):
        ch = s[i]
        if in_quote:
            if ch == in_quote: in_quote = None
            out.append(ch)
        elif ch in ('"', "'"):
            in_quote = ch
            out.append(ch)
        elif ch == '#' and (i == 0 or s[i-1].isspace()):
            break
        else:
            out.append(ch)
        i += 1
    s = ''.join(out).rstrip()
    if len(s) >= 2 and ((s[0] == s[-1] == '"') or (s[0] == s[-1] == "'")):
        s = s[1:-1]
    if s in ('null', '~', ''): return None
    if s == 'true':  return True
    if s == 'false': return False
    try: return int(s)
    except ValueError: pass
    try: return float(s)
    except ValueError: pass
    return s

root = {}
stack = [(-1, root)]
with open(file) as fh:
    for raw in fh:
        if not raw.strip() or raw.lstrip().startswith('#'):
            continue
        stripped = raw.lstrip(' ')
        indent = len(raw) - len(stripped)
        line = stripped.rstrip('\n')
        while stack and stack[-1][0] >= indent:
            stack.pop()
        parent = stack[-1][1] if stack else root
        m = re.match(r'^([A-Za-z_][\w-]*)\s*:\s*(.*)$', line)
        if not m: continue
        k, rest = m.group(1), m.group(2).rstrip()
        if rest == '':
            new_dict = {}
            parent[k] = new_dict
            stack.append((indent, new_dict))
        else:
            parent[k] = _coerce(rest)

node = root
for part in key.split('.'):
    if isinstance(node, dict) and part in node:
        node = node[part]
    else:
        sys.exit(0)

if isinstance(node, dict):
    for child_key in node.keys():
        print(child_key)
PY
}

# Convenience getters
stack_project_slug()    { stack_manifest project.slug "$(basename "$STACK_REPO_ROOT")"; }
stack_project_name()    { stack_manifest project.name "$(stack_project_slug)"; }
stack_project_app()     { stack_manifest project.app "apps/core"; }
stack_project_pkg()     { stack_manifest project.package; }
stack_domain_dev()      { stack_manifest project.domain_dev "$(stack_project_slug).loc"; }
stack_default_profile() { stack_manifest default_profile full; }
stack_deploy_target()   { stack_manifest deploy_target vps; }
stack_service_app()     { stack_manifest services.app core; }
stack_service_db()      { stack_manifest services.db postgres; }
stack_service_proxy()   { stack_manifest services.proxy caddy; }
stack_db_user()         { stack_manifest db.user "$(stack_project_slug)"; }
stack_db_name()         { stack_manifest db.database "$(stack_project_slug)"; }
stack_db_default_pass() { stack_manifest db.default_password "$(stack_db_user)"; }

stack_compose_file() {
  local profile=${1:-$(stack_default_profile)}
  stack_manifest "compose.$profile"
}

# -----------------------------------------------------------------------------
# Hashing — used by the port allocator. macOS has `shasum`, Linux has `sha256sum`.
# -----------------------------------------------------------------------------
stack_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    printf "%s" "$1" | sha256sum | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    printf "%s" "$1" | shasum -a 256 | awk '{print $1}'
  else
    stack_die "neither sha256sum nor shasum available"
    return 1
  fi
}

# -----------------------------------------------------------------------------
# Dependency checks
# -----------------------------------------------------------------------------

stack_have() { command -v "$1" >/dev/null 2>&1; }

stack_require() {
  local missing=()
  for tool in "$@"; do
    stack_have "$tool" || missing+=("$tool")
  done
  if (( ${#missing[@]} > 0 )); then
    stack_die "missing required tool(s): ${missing[*]}"
    return 1
  fi
}

# Docker daemon health
stack_docker_ok() {
  stack_have docker || return 1
  docker info >/dev/null 2>&1
}

# -----------------------------------------------------------------------------
# Confirmation prompts
# -----------------------------------------------------------------------------

stack_confirm() {
  # stack_confirm "message" "unlock-phrase"
  # Returns 0 if the user typed the exact phrase, 1 otherwise.
  local prompt=$1 expected=$2
  printf "%s\n%s Type %s%s%s to confirm: " \
    "${C_YELLOW}${prompt}${C_RESET}" \
    "${C_DIM}»${C_RESET}" \
    "${C_BOLD}" "$expected" "${C_RESET}" >&2
  local answer
  read -r answer
  [[ "$answer" == "$expected" ]]
}

# -----------------------------------------------------------------------------
# Initialize on source
# -----------------------------------------------------------------------------
stack_ensure_home
