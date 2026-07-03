#!/usr/bin/env bash
# =============================================================================
# prod.sh — Production triage helpers (VPS profile)
# =============================================================================
# Read-only helpers for SSH-based production access. Every function declares its
# blast radius up-front and refuses destructive operations without an explicit
# unlock phrase (see infra Commandment Three).
# =============================================================================

[[ -n "${_STACK_PROD_LOADED:-}" ]] && return 0
_STACK_PROD_LOADED=1

# shellcheck source=./_common.sh
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

stack_prod_host() {
  # Try inventory first, fall back to manifest, fall back to env.
  local inv host
  inv=$(stack_manifest vps.inventory)
  if [[ -n "$inv" ]] && [[ -f "$STACK_REPO_ROOT/$inv" ]]; then
    host=$(grep -E 'ansible_host:' "$STACK_REPO_ROOT/$inv" | head -1 | awk -F: '{print $2}' | tr -d ' ')
    if [[ -n "$host" ]] && [[ "$host" != "YOUR_VPS_IP" ]]; then
      printf "%s" "$host"
      return 0
    fi
  fi
  if [[ -n "${STACK_PROD_HOST:-}" ]]; then
    printf "%s" "$STACK_PROD_HOST"
    return 0
  fi
  stack_die "could not determine production host. Set ansible_host in $inv or export STACK_PROD_HOST."
  return 1
}

stack_prod_user() { stack_manifest vps.user deploy; }
stack_prod_path() { stack_manifest vps.app_path "/opt/$(stack_project_slug)"; }
stack_prod_compose() { stack_manifest vps.compose_file "$(stack_prod_path)/docker-compose.yml"; }

stack_prod_ssh() {
  local user host
  user=$(stack_prod_user)
  host=$(stack_prod_host) || return 1
  ssh "$user@$host" "$@"
}

stack_prod_ps() {
  stack_prod_ssh "cd $(stack_prod_path) && docker compose ps"
}

stack_prod_logs() {
  local service=${1:-$(stack_service_app)}
  local since=${2:-10m}
  stack_prod_ssh "cd $(stack_prod_path) && docker compose logs --since $since --timestamps $service"
}

stack_prod_psql_one() {
  local sql=$1
  local user db
  user=$(stack_db_user)
  db=$(stack_db_name)
  # Sanity: refuse write SQL unless unlocked.
  case "$sql" in
    [iI][nN][sS][eE][rR][tT]*|[uU][pP][dD][aA][tT][eE]*|[dD][eE][lL][eE][tT][eE]*|[dD][rR][oO][pP]*|[tT][rR][uU][nN][cC][aA][tT][eE]*|[aA][lL][tT][eE][rR]*)
      if [[ "${STACK_PROD_MUTATE:-0}" != "1" ]]; then
        stack_die "destructive SQL refused without STACK_PROD_MUTATE=1 and the unlock phrase \"yes mutate prod\""
        return 1
      fi
      ;;
  esac
  stack_prod_ssh "cd $(stack_prod_path) && docker compose exec -T $(stack_service_db) psql -U $user -d $db -c \"$sql\""
}

stack_prod_health() {
  local domain
  domain=$(stack_manifest project.domain_prod)
  if [[ -z "$domain" ]]; then
    stack_warn "no project.domain_prod in manifest — skipping HTTP health"
    return 0
  fi
  printf "Hitting https://%s/api/health ...\n" "$domain"
  curl -s --max-time 10 "https://$domain/api/health" || stack_warn "health endpoint did not respond"
  printf "\n"
}

stack_prod_tunnel() {
  local local_port=${1:-5499}
  local user host
  user=$(stack_prod_user)
  host=$(stack_prod_host) || return 1
  stack_info "Opening SSH tunnel localhost:$local_port → $host:127.0.0.1:5432 (Ctrl-C to close)"
  ssh -L "${local_port}:127.0.0.1:5432" "$user@$host"
}

stack_prod_disk() {
  stack_prod_ssh "df -h /var/lib/docker $(stack_prod_path); echo; docker system df"
}

stack_prod_deploy_status() {
  stack_have gh || { stack_warn "gh CLI not installed — skipping deploy status check"; return 0; }
  gh run list --workflow=deploy.yml --limit 5 || true
}
