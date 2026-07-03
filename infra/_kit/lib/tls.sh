#!/usr/bin/env bash
# =============================================================================
# tls.sh — mkcert-based local TLS for the Nucleus Stack Kit
# =============================================================================
# Generates locally-trusted TLS certs for the project's domain_dev so that
# `https://<slug>.loc` works in every browser, on every OS, with no warning.
#
# Strategy: use mkcert (https://github.com/FiloSottile/mkcert) — one tool that
# (a) creates a CA only your machine trusts, (b) installs it into every system
# + browser trust store, (c) signs short-lived dev certs against that CA.
#
# Full background, troubleshooting, cross-platform install:
#   infra/_kit/TLS.md
# =============================================================================

[[ -n "${_STACK_TLS_LOADED:-}" ]] && return 0
_STACK_TLS_LOADED=1

# shellcheck source=./_common.sh
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
# shellcheck source=./compose.sh
source "$(dirname "${BASH_SOURCE[0]}")/compose.sh"

# Where the project keeps its TLS material. Gitignored; per-machine.
stack_tls_dir() {
  printf "%s/infra/certs" "$STACK_REPO_ROOT"
}

# Files for a given hostname.
stack_tls_cert_path() { printf "%s/%s.pem"      "$(stack_tls_dir)" "$1"; }
stack_tls_key_path()  { printf "%s/%s-key.pem"  "$(stack_tls_dir)" "$1"; }

# Verify mkcert is installed and the CA has been registered.
stack_tls_check_mkcert() {
  if ! stack_have mkcert; then
    stack_fail "mkcert is not installed." \
               "Install it once per machine — see infra/_kit/TLS.md for the OS-specific command (macOS: 'brew install mkcert nss')."
    return 1
  fi
  local caroot
  caroot=$(mkcert -CAROOT 2>/dev/null)
  if [[ -z "$caroot" ]] || [[ ! -f "$caroot/rootCA.pem" ]]; then
    stack_fail "mkcert is installed but its CA has not been initialised." \
               "Run once:  mkcert -install   (creates a local CA and registers it in your trust stores). See infra/_kit/TLS.md."
    return 1
  fi
  return 0
}

# Generate (or regenerate) a cert for the project's domain_dev.
# Idempotent: re-running overwrites the existing files.
stack_tls_install() {
  local domain
  domain=$(stack_domain_dev)
  if [[ -z "$domain" ]]; then
    stack_fail "No project.domain_dev set in infra/_kit/manifest.yaml." \
               "Add a value like 'your-app.loc' under project.domain_dev, then retry."
    return 1
  fi

  stack_tls_check_mkcert || return 1

  local dir cert key
  dir=$(stack_tls_dir)
  cert=$(stack_tls_cert_path "$domain")
  key=$(stack_tls_key_path "$domain")

  stack_step "Generate TLS cert for $domain"
  mkdir -p "$dir"

  # Subject Alternative Names: the bare hostname, a wildcard for subdomains
  # (e.g. branch-named worktrees via portless), localhost, and IPv4/IPv6
  # loopback so curl/tests that bypass DNS still validate.
  (
    cd "$dir" && \
    mkcert -cert-file "$(basename "$cert")" \
           -key-file  "$(basename "$key")" \
           "$domain" "*.${domain}" localhost 127.0.0.1 ::1
  ) || {
    stack_fail "mkcert failed to generate the cert." \
               "Try running mkcert directly to see the error:  cd $dir && mkcert $domain"
    return 1
  }

  stack_ok "Cert: $cert"
  stack_ok "Key:  $key"

  # Set restrictive perms on the private key (mkcert already does this on
  # most platforms; we re-assert for safety).
  chmod 600 "$key" 2>/dev/null || true

  # Report expiry.
  local expiry
  expiry=$(openssl x509 -in "$cert" -noout -enddate 2>/dev/null | sed 's/notAfter=//')
  [[ -n "$expiry" ]] && stack_info "Expires: $expiry"

  # Verify the cert chains to mkcert's CA.
  local caroot
  caroot=$(mkcert -CAROOT 2>/dev/null)
  if [[ -f "$caroot/rootCA.pem" ]]; then
    if openssl verify -CAfile "$caroot/rootCA.pem" "$cert" >/dev/null 2>&1; then
      stack_ok "Cert chains to mkcert's local CA."
    else
      stack_warn "Cert generated but verification against mkcert's CA failed — manual inspection needed."
    fi
  fi

  # Caddyfile sanity — the kit doesn't auto-patch the Caddyfile yet, but it
  # warns clearly when the project still says 'tls internal' so the user
  # knows to update it (or follows the kit's AGENT.md).
  local caddyfile="$STACK_REPO_ROOT/infra/Caddyfile.dev"
  if [[ -f "$caddyfile" ]] && grep -q 'tls internal' "$caddyfile"; then
    stack_warn "infra/Caddyfile.dev still uses 'tls internal' — caddy will keep using its self-signed CA until you update it."
    stack_hint "Edit infra/Caddyfile.dev: replace 'tls internal' with"
    stack_hint "  tls /etc/caddy/certs/${domain}.pem /etc/caddy/certs/${domain}-key.pem"
  fi

  # Compose sanity — verify the caddy service mounts ./certs.
  local compose_file
  compose_file=$(stack_compose_file full)
  if [[ -f "$STACK_REPO_ROOT/$compose_file" ]] && \
     ! grep -q '/etc/caddy/certs' "$STACK_REPO_ROOT/$compose_file"; then
    stack_warn "$compose_file does not mount ./certs:/etc/caddy/certs:ro into the caddy service."
    stack_hint "Add to the caddy service's 'volumes:' block:"
    stack_hint "  - ./certs:/etc/caddy/certs:ro"
  fi

  # .gitignore sanity.
  if [[ -f "$STACK_REPO_ROOT/.gitignore" ]] && \
     ! grep -qE '(^|/)infra/certs/?($|[[:space:]])' "$STACK_REPO_ROOT/.gitignore"; then
    stack_warn ".gitignore is missing an entry for infra/certs/"
    stack_hint "Add this line to .gitignore so private keys never get committed:"
    stack_hint "  infra/certs/"
  fi

  # Reload caddy if the stack is running.
  local profile svc_proxy proj
  profile=$(stack_default_profile)
  svc_proxy=$(stack_service_proxy)
  proj=$(stack_compose_project_name)
  if docker compose -f "$compose_file" -p "$proj" ps "$svc_proxy" --status running >/dev/null 2>&1; then
    stack_step "Reload caddy so the new cert takes effect"
    stack_compose "$profile" up -d --no-deps --force-recreate "$svc_proxy" 2>&1 | tail -5
    stack_ok "Caddy recreated."
  else
    stack_info "Caddy not running — new cert will be picked up on next 'stack up'."
  fi

  # Smoke test. Give caddy a moment to bind after the recreate.
  stack_step "Smoke test"
  sleep 2
  local code
  code=$(curl -s -o /dev/null -m 5 -w "%{http_code}" "https://$domain/api/health" 2>/dev/null)
  local rc=$?
  if (( rc != 0 )) || [[ -z "$code" ]] || [[ "$code" == "000" ]]; then
    stack_warn "Could not reach https://$domain (curl rc=$rc). Likely the stack isn't running."
    stack_hint "Try: stack up      (or, if up, re-run: stack tls install — caddy may have been mid-reload)"
  elif [[ "$code" == "200" ]]; then
    stack_ok "https://$domain/api/health → HTTP 200, cert validated by system trust store."
  else
    stack_warn "https://$domain returned HTTP $code — cert is valid but the app isn't healthy. Run: stack logs $(stack_service_app)"
  fi
}

# Inspect existing certs — paths, expiry, validity.
stack_tls_status() {
  local domain dir cert key
  domain=$(stack_domain_dev)
  dir=$(stack_tls_dir)
  cert=$(stack_tls_cert_path "$domain")
  key=$(stack_tls_key_path "$domain")

  printf "\n%sTLS status for %s%s\n\n" "${C_BOLD}" "$domain" "${C_RESET}"

  if ! stack_have mkcert; then
    printf "  %s mkcert not installed.\n" "${C_RED}✗${C_RESET}"
    printf "  %s See infra/_kit/TLS.md for the install command.\n" "${C_DIM}→${C_RESET}"
    return 1
  fi
  printf "  %s mkcert installed at %s\n" "${C_GREEN}✓${C_RESET}" "$(command -v mkcert)"

  local caroot
  caroot=$(mkcert -CAROOT 2>/dev/null)
  if [[ -f "$caroot/rootCA.pem" ]]; then
    printf "  %s Local CA at %s/rootCA.pem\n" "${C_GREEN}✓${C_RESET}" "$caroot"
  else
    printf "  %s Local CA not initialised. Run: mkcert -install\n" "${C_RED}✗${C_RESET}"
    return 1
  fi

  if [[ ! -f "$cert" ]]; then
    printf "  %s No cert for %s yet. Run: stack tls install\n" "${C_YELLOW}⚠${C_RESET}" "$domain"
    # No cert is an advisory state (mkcert is ready, cert just hasn't been
    # generated). Exit 0 so that `stack doctor` and `stack tls status` don't
    # report a hard failure when the user simply hasn't run `tls install` yet.
    return 0
  fi

  printf "  %s Cert: %s\n" "${C_GREEN}✓${C_RESET}" "$cert"
  printf "  %s Key:  %s\n" "${C_GREEN}✓${C_RESET}" "$key"

  local subject issuer notbefore notafter
  subject=$(openssl x509 -in "$cert" -noout -subject 2>/dev/null | sed 's/subject= *//')
  issuer=$(openssl  x509 -in "$cert" -noout -issuer  2>/dev/null | sed 's/issuer= *//')
  notbefore=$(openssl x509 -in "$cert" -noout -startdate 2>/dev/null | sed 's/notBefore=//')
  notafter=$(openssl  x509 -in "$cert" -noout -enddate   2>/dev/null | sed 's/notAfter=//')

  printf "  %s Subject:  %s\n" "${C_DIM}·${C_RESET}" "$subject"
  printf "  %s Issuer:   %s\n" "${C_DIM}·${C_RESET}" "$issuer"
  printf "  %s Valid:    %s  →  %s\n" "${C_DIM}·${C_RESET}" "$notbefore" "$notafter"

  # Days until expiry.
  if [[ -n "$notafter" ]]; then
    local end_ts now_ts days
    end_ts=$(date -j -f "%b %d %H:%M:%S %Y %Z" "$notafter" "+%s" 2>/dev/null || date -d "$notafter" "+%s" 2>/dev/null || echo 0)
    now_ts=$(date "+%s")
    if (( end_ts > 0 )); then
      days=$(( (end_ts - now_ts) / 86400 ))
      if (( days < 30 )); then
        printf "  %s Expires in %d days — consider running: stack tls renew\n" "${C_YELLOW}⚠${C_RESET}" "$days"
      elif (( days < 60 )); then
        printf "  %s Expires in %d days.\n" "${C_YELLOW}⚠${C_RESET}" "$days"
      else
        printf "  %s Expires in %d days.\n" "${C_GREEN}✓${C_RESET}" "$days"
      fi
    fi
  fi

  # Trust-chain verify.
  local chain_ok=0
  if openssl verify -CAfile "$caroot/rootCA.pem" "$cert" >/dev/null 2>&1; then
    printf "  %s Chains to mkcert's local CA.\n" "${C_GREEN}✓${C_RESET}"
  else
    printf "  %s Cert does NOT chain to mkcert's CA — regenerate: stack tls renew\n" "${C_RED}✗${C_RESET}"
    chain_ok=1
  fi

  printf "\n"
  return "$chain_ok"
}

# Alias — renewal is just re-install.
stack_tls_renew() {
  stack_info "Renewing TLS cert (this is the same as 'tls install' — mkcert overwrites)."
  stack_tls_install
}

# Nuclear option — delete this project's cert files.
stack_tls_uninstall() {
  local dir
  dir=$(stack_tls_dir)
  if [[ ! -d "$dir" ]]; then
    stack_info "No cert dir at $dir — nothing to remove."
    return 0
  fi
  stack_warn "About to delete: $dir"
  stack_hint "Note: this does NOT remove mkcert's CA from your trust store."
  stack_hint "      To remove the CA entirely (affects ALL projects):  mkcert -uninstall"
  if ! stack_confirm "Delete project certs?" "yes delete certs"; then
    stack_err "Aborted."
    return 1
  fi
  rm -rf "$dir"
  stack_ok "Removed $dir"
}
