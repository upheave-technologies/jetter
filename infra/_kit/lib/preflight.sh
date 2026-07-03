#!/usr/bin/env bash
# =============================================================================
# preflight.sh — Per-command preflight checks for the Nucleus Stack Kit
# =============================================================================
# Each `stack_check_*` function checks ONE condition and emits a friendly
# error + hint on failure. `stack_preflight <kind>` composes the right
# combination for each command. The result: every failure is actionable.
#
# The kit's contract: a `stack` command should never fail with a cryptic
# error. If you hit one, that's a kit bug — add a check here.
# =============================================================================

[[ -n "${_STACK_PREFLIGHT_LOADED:-}" ]] && return 0
_STACK_PREFLIGHT_LOADED=1

# shellcheck source=./_common.sh
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

# -----------------------------------------------------------------------------
# Atomic checks
# -----------------------------------------------------------------------------

stack_check_kit() {
  local mf
  mf=$(stack_manifest_file)
  [[ -f "$mf" ]] || {
    stack_fail "Nucleus Stack Kit not installed in this repo (missing $mf)." \
               "Ask the agent: /infra-bootstrap install — or cd to a repo that has the kit."
    return 1
  }
  return 0
}

stack_check_python() {
  stack_have python3 || {
    stack_fail "python3 not installed — needed by the manifest reader." \
               "Install:  brew install python3   (macOS)   or   sudo apt install python3   (Linux)."
    return 1
  }
  # Sanity-check the manifest is actually readable.
  local slug
  slug=$(stack_project_slug 2>/dev/null)
  if [[ -z "$slug" ]]; then
    stack_fail "Could not read project.slug from $(stack_manifest_file)." \
               "Open the manifest and confirm 'project:' has a 'slug:' line at the top level."
    return 1
  fi
  return 0
}

stack_check_git() {
  stack_have git || {
    stack_fail "git not installed — needed for worktree detection." \
               "Install:  brew install git   (macOS)   or   sudo apt install git   (Linux)."
    return 1
  }
  return 0
}

stack_check_docker_installed() {
  stack_have docker || {
    stack_fail "Docker not installed." \
               "Install Docker Desktop (macOS/Windows) or docker-ce on Linux: https://docs.docker.com/get-docker/"
    return 1
  }
  return 0
}

stack_check_docker_daemon() {
  stack_check_docker_installed || return 1
  if ! docker info >/dev/null 2>&1; then
    stack_fail "Docker daemon is not running." \
               "Start Docker Desktop (macOS/Windows) or 'sudo systemctl start docker' (Linux), then retry."
    return 1
  fi
  return 0
}

stack_check_docker_compose() {
  stack_check_docker_daemon || return 1
  if ! docker compose version >/dev/null 2>&1; then
    stack_fail "docker compose v2 not available." \
               "Update Docker Desktop, or install the docker-compose-plugin package on Linux."
    return 1
  fi
  return 0
}

stack_check_env() {
  local profile=${1:-$(stack_default_profile)}
  local f ex
  f=$(stack_manifest env_files.compose "infra/.env")
  ex=$(stack_manifest env_files.compose_example "infra/.env.example")
  if [[ ! -f "$STACK_REPO_ROOT/$f" ]]; then
    if [[ -f "$STACK_REPO_ROOT/$ex" ]]; then
      stack_fail "Missing env file: $f" \
                 "Copy the template:  cp $ex $f   then open $f and fill in your dev secrets."
    else
      stack_fail "Missing env file: $f (and the example $ex is also missing)" \
                 "Create $f with your project's dev secrets. See the kit README for what variables to set."
    fi
    return 1
  fi
  return 0
}

stack_check_compose_file() {
  local profile=${1:-$(stack_default_profile)}
  local cf
  cf=$(stack_compose_file "$profile")
  if [[ -z "$cf" ]]; then
    stack_fail "No compose file configured for profile=$profile." \
               "Check infra/_kit/manifest.yaml → compose.$profile."
    return 1
  fi
  if [[ ! -f "$STACK_REPO_ROOT/$cf" ]]; then
    stack_fail "Compose file not found: $cf  (profile=$profile)" \
               "Either correct the path in infra/_kit/manifest.yaml → compose.$profile, or create the file."
    return 1
  fi
  return 0
}

stack_check_stack_running() {
  local profile=${1:-$(stack_default_profile)}
  local svc_db proj
  svc_db=$(stack_service_db)
  proj=$(stack_compose_project_name 2>/dev/null)
  if ! stack_compose "$profile" ps "$svc_db" --status running >/dev/null 2>&1; then
    stack_fail "Stack not running for this worktree (compose project: ${proj:-unknown})." \
               "Boot it first:  stack up"
    return 1
  fi
  return 0
}

stack_check_seeds_dir() {
  local dir
  dir=$(stack_manifest seeds_dir "infra/_kit/seeds")
  if [[ ! -d "$STACK_REPO_ROOT/$dir" ]]; then
    stack_fail "Seeds directory not found: $dir" \
               "Create it:  mkdir -p $dir   then author scenarios there (see infra/_kit/seeds/README.md)."
    return 1
  fi
  return 0
}

stack_check_prod_inventory() {
  local inv
  inv=$(stack_manifest vps.inventory)
  if [[ -z "$inv" ]]; then
    stack_fail "No vps.inventory set in manifest.yaml — this project may not be VPS-deployed." \
               "If this is a Vercel/Neon project, use /infra-cloud-triage instead. If VPS, add vps.inventory to the manifest."
    return 1
  fi
  if [[ ! -f "$STACK_REPO_ROOT/$inv" ]]; then
    stack_fail "Ansible inventory not found: $inv" \
               "First-time setup:  cd infra/ansible && cp inventory.yml.example inventory.yml   then edit with the VPS IP."
    return 1
  fi
  local host
  host=$(grep -E '^[[:space:]]*ansible_host:' "$STACK_REPO_ROOT/$inv" 2>/dev/null | head -1 | awk -F: '{print $2}' | tr -d ' ')
  if [[ -z "$host" ]] || [[ "$host" == "YOUR_VPS_IP" ]]; then
    stack_fail "Inventory exists but ansible_host is not set (current: ${host:-empty})." \
               "Open $inv and replace YOUR_VPS_IP with the actual VPS IP."
    return 1
  fi
  return 0
}

stack_check_mkcert() {
  stack_have mkcert || {
    stack_fail "mkcert is not installed." \
               "Install once per machine — see infra/_kit/TLS.md. macOS:  brew install mkcert nss   then  mkcert -install"
    return 1
  }
  local caroot
  caroot=$(mkcert -CAROOT 2>/dev/null)
  if [[ -z "$caroot" ]] || [[ ! -f "$caroot/rootCA.pem" ]]; then
    stack_fail "mkcert is installed but its CA is not initialised." \
               "Run once:  mkcert -install   (registers a local CA in your trust stores). See infra/_kit/TLS.md."
    return 1
  fi
  return 0
}

stack_check_tunnel_provider() {
  local provider=$1
  case $provider in
    ngrok)
      stack_have ngrok || {
        stack_fail "ngrok not installed." \
                   "Install:  brew install ngrok/ngrok/ngrok   (macOS)   or download from https://ngrok.com/download"
        return 1
      }
      ;;
    cloudflared)
      stack_have cloudflared || {
        stack_fail "cloudflared not installed." \
                   "Install:  brew install cloudflared   (macOS)   or see https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/"
        return 1
      }
      ;;
    portless)
      stack_have portless || {
        stack_fail "portless not installed." \
                   "Install:  npm install -g @vercel/portless   (and run 'portless proxy start' first)"
        return 1
      }
      ;;
  esac
  return 0
}

# -----------------------------------------------------------------------------
# Composite preflights — one per command kind.
# Returns nonzero on the first failed check (so the user can act on the most
# upstream issue first).
# -----------------------------------------------------------------------------

stack_preflight() {
  local kind=${1:-}
  local profile=${2:-$(stack_default_profile)}

  case "$kind" in
    up)
      stack_check_kit          || return 1
      stack_check_python       || return 1
      stack_check_git          || return 1
      stack_check_docker_compose || return 1
      stack_check_env "$profile"          || return 1
      stack_check_compose_file "$profile" || return 1
      ;;
    down|restart|ps|logs)
      stack_check_kit          || return 1
      stack_check_python       || return 1
      stack_check_docker_daemon || return 1
      stack_check_compose_file "$profile" || return 1
      ;;
    ports|reset)
      stack_check_kit          || return 1
      stack_check_python       || return 1
      ;;
    psql|exec|seed-apply|seed-reset)
      stack_check_kit          || return 1
      stack_check_python       || return 1
      stack_check_docker_daemon || return 1
      stack_check_stack_running "$profile" || return 1
      ;;
    seed-list|seed-new|seed-inspect)
      stack_check_kit          || return 1
      stack_check_python       || return 1
      stack_check_seeds_dir    || return 1
      ;;
    tunnel)
      stack_check_kit          || return 1
      stack_check_python       || return 1
      ;;
    tls-install|tls-renew)
      stack_check_kit          || return 1
      stack_check_python       || return 1
      stack_check_mkcert       || return 1
      ;;
    tls-status|tls-uninstall)
      stack_check_kit          || return 1
      stack_check_python       || return 1
      ;;
    dashboard)
      stack_check_kit          || return 1
      stack_check_python       || return 1
      ;;
    triage-prod)
      stack_check_kit          || return 1
      stack_check_python       || return 1
      stack_check_prod_inventory || return 1
      ;;
    doctor|help|"")
      # These commands ARE the diagnostic — they should run regardless.
      return 0
      ;;
    *)
      # Unknown command — let the dispatcher handle it.
      return 0
      ;;
  esac
  return 0
}
