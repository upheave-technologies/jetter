#!/usr/bin/env bash
# =============================================================================
# doctor.sh — environment diagnostics for the Nucleus Stack Kit
# =============================================================================

[[ -n "${_STACK_DOCTOR_LOADED:-}" ]] && return 0
_STACK_DOCTOR_LOADED=1

# shellcheck source=./_common.sh
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

stack_doctor() {
  local quiet=${1:-0}
  local rc=0

  declare -a checks=()

  # ---------------------------------------------------------------------------
  # Required tools
  # ---------------------------------------------------------------------------
  for tool in docker git python3; do
    if stack_have "$tool"; then
      checks+=("ok|tool|$tool")
    else
      checks+=("err|tool|$tool missing"); rc=1
    fi
  done

  if stack_have docker; then
    if docker info >/dev/null 2>&1; then
      checks+=("ok|docker|daemon running")
    else
      checks+=("err|docker|daemon not running (start Docker Desktop)"); rc=1
    fi
    if docker compose version >/dev/null 2>&1; then
      checks+=("ok|docker|compose v2 available")
    else
      checks+=("err|docker|compose v2 unavailable"); rc=1
    fi
  fi

  # ---------------------------------------------------------------------------
  # Manifest sanity
  # ---------------------------------------------------------------------------
  if [[ -f "$(stack_manifest_file)" ]]; then
    local slug profile
    slug=$(stack_project_slug)
    profile=$(stack_default_profile)
    checks+=("ok|kit|manifest present (slug=$slug, default_profile=$profile)")
  else
    checks+=("err|kit|manifest.yaml missing — run /infra-bootstrap")
    rc=1
  fi

  # ---------------------------------------------------------------------------
  # Compose files
  # ---------------------------------------------------------------------------
  for prof in minimal full prod; do
    local cf
    cf=$(stack_compose_file "$prof")
    if [[ -z "$cf" ]]; then
      checks+=("warn|compose|profile=$prof not configured (skipping)")
    elif [[ -f "$STACK_REPO_ROOT/$cf" ]]; then
      checks+=("ok|compose|$cf")
    else
      checks+=("warn|compose|$cf not found (profile=$prof unusable)")
    fi
  done

  # ---------------------------------------------------------------------------
  # Env files
  # ---------------------------------------------------------------------------
  local env_compose env_compose_ex env_host env_host_ex
  env_compose=$(stack_manifest env_files.compose "infra/.env")
  env_compose_ex=$(stack_manifest env_files.compose_example "infra/.env.example")
  env_host=$(stack_manifest env_files.host)
  env_host_ex=$(stack_manifest env_files.host_example)

  if [[ -f "$STACK_REPO_ROOT/$env_compose" ]]; then
    checks+=("ok|env|$env_compose present")
  elif [[ -f "$STACK_REPO_ROOT/$env_compose_ex" ]]; then
    checks+=("warn|env|$env_compose missing — run: cp $env_compose_ex $env_compose")
  fi

  if [[ -n "$env_host" ]] && [[ -f "$STACK_REPO_ROOT/$env_host" ]]; then
    checks+=("ok|env|$env_host present")
  elif [[ -n "$env_host_ex" ]] && [[ -f "$STACK_REPO_ROOT/$env_host_ex" ]]; then
    checks+=("warn|env|$env_host missing — run: cp $env_host_ex $env_host")
  fi

  # ---------------------------------------------------------------------------
  # Port allocation
  # ---------------------------------------------------------------------------
  if [[ -f "$STACK_REPO_ROOT/infra/.ports" ]]; then
    local key
    # shellcheck disable=SC1091
    key=$(grep '^STACK_KEY=' "$STACK_REPO_ROOT/infra/.ports" | cut -d= -f2)
    checks+=("ok|ports|allocated ($key)")
  else
    checks+=("info|ports|no allocation yet (will be created on first \`stack up\`)")
  fi

  # ---------------------------------------------------------------------------
  # Optional tools
  # ---------------------------------------------------------------------------
  for tool in ansible vercel neonctl portless ngrok cloudflared; do
    if stack_have "$tool"; then
      checks+=("ok|optional|$tool present")
    else
      checks+=("info|optional|$tool not installed (only needed for specific flows)")
    fi
  done

  # ---------------------------------------------------------------------------
  # TLS / mkcert state (only relevant if the project has a dev domain)
  # ---------------------------------------------------------------------------
  local domain
  domain=$(stack_domain_dev)
  if [[ -n "$domain" ]]; then
    if ! stack_have mkcert; then
      checks+=("warn|tls|mkcert not installed — https://${domain} will warn in browsers. See infra/_kit/TLS.md.")
    else
      local caroot
      caroot=$(mkcert -CAROOT 2>/dev/null)
      if [[ ! -f "$caroot/rootCA.pem" ]]; then
        checks+=("warn|tls|mkcert installed but CA not initialised — run: mkcert -install")
      else
        local cert="$STACK_REPO_ROOT/infra/certs/${domain}.pem"
        if [[ ! -f "$cert" ]]; then
          checks+=("info|tls|no cert for ${domain} yet — run: stack tls install")
        else
          # Use `openssl x509 -checkend N` — returns 0 iff cert valid for N+ more seconds.
          # Portable across BSD / GNU. Probe at three thresholds.
          local notafter
          notafter=$(openssl x509 -in "$cert" -noout -enddate 2>/dev/null | sed 's/notAfter=//')
          if ! openssl x509 -in "$cert" -noout -checkend 0 >/dev/null 2>&1; then
            checks+=("err|tls|cert for ${domain} has expired (notAfter ${notafter}) — run: stack tls renew")
          elif ! openssl x509 -in "$cert" -noout -checkend 2592000 >/dev/null 2>&1; then
            # 30 days
            checks+=("warn|tls|cert for ${domain} expires within 30 days (notAfter ${notafter}) — run: stack tls renew")
          elif ! openssl x509 -in "$cert" -noout -checkend 5184000 >/dev/null 2>&1; then
            # 60 days
            checks+=("warn|tls|cert for ${domain} expires within 60 days (notAfter ${notafter})")
          else
            checks+=("ok|tls|cert for ${domain} valid (notAfter ${notafter})")
          fi
        fi
      fi
    fi
  fi

  # ---------------------------------------------------------------------------
  # Output
  # ---------------------------------------------------------------------------
  if [[ "$quiet" == "1" ]] && [[ "$rc" == "0" ]]; then
    return 0
  fi

  printf "\n%s\n" "${C_BOLD}Stack Doctor — ${STACK_REPO_ROOT}${C_RESET}"
  printf "%s\n\n" "${C_DIM}kit at: $STACK_KIT_DIR${C_RESET}"
  for c in "${checks[@]}"; do
    local level cat msg
    level=${c%%|*}; rest=${c#*|}
    cat=${rest%%|*}; msg=${rest#*|}
    case $level in
      ok)   printf "  %s %-10s %s\n" "${C_GREEN}✓${C_RESET}" "$cat" "$msg" ;;
      err)  printf "  %s %-10s %s\n" "${C_RED}✗${C_RESET}"   "$cat" "$msg" ;;
      warn) printf "  %s %-10s %s\n" "${C_YELLOW}⚠${C_RESET}" "$cat" "$msg" ;;
      info) printf "  %s %-10s %s\n" "${C_DIM}·${C_RESET}"   "$cat" "$msg" ;;
    esac
  done
  printf "\n"

  return "$rc"
}
