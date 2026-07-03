#!/usr/bin/env bash
# =============================================================================
# seed.sh — Scenario seed runner for the Nucleus Stack Kit
# =============================================================================
# Applies a seed scenario from infra/_kit/seeds/<name>.{sql,ts,sh} against
# the running local stack. Idempotency, verification, and logging baked in.
# =============================================================================

[[ -n "${_STACK_SEED_LOADED:-}" ]] && return 0
_STACK_SEED_LOADED=1

# shellcheck source=./_common.sh
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
# shellcheck source=./compose.sh
source "$(dirname "${BASH_SOURCE[0]}")/compose.sh"

stack_seed_dir() {
  local d
  d=$(stack_manifest seeds_dir "infra/_kit/seeds")
  printf "%s/%s" "$STACK_REPO_ROOT" "$d"
}

stack_seed_list() {
  local dir
  dir=$(stack_seed_dir)
  if [[ ! -d "$dir" ]]; then
    stack_warn "seeds dir not found: $dir"
    return 0
  fi
  printf "\n%sScenarios in %s:%s\n\n" "${C_BOLD}" "$dir" "${C_RESET}"
  local found=0
  shopt -s nullglob
  for f in "$dir"/*.sql "$dir"/*.ts "$dir"/*.sh; do
    [[ -f "$f" ]] || continue
    found=1
    local name purpose idempotent
    name=$(basename "$f")
    purpose=$(grep -E '^[ -]*@purpose:' "$f" | head -1 | sed 's/.*@purpose:[[:space:]]*//')
    idempotent=$(grep -E '^[ -]*@idempotent:' "$f" | head -1 | sed 's/.*@idempotent:[[:space:]]*//')
    printf "  %-40s %s%s%s\n" "$name" "${C_DIM}" "$purpose" "${C_RESET}"
    [[ "$idempotent" != "true" ]] && printf "    %s⚠ not idempotent — refused%s\n" "$C_YELLOW" "$C_RESET"
  done
  shopt -u nullglob
  (( found == 0 )) && printf "  %s(none)%s\n" "$C_DIM" "$C_RESET"
}

stack_seed_inspect() {
  local name=$1
  local file
  file=$(stack_seed_resolve "$name") || return 1
  printf "\n%s── %s ──%s\n" "$C_BOLD" "$(basename "$file")" "$C_RESET"
  grep -E '^[ -]*@(scenario|purpose|idempotent|requires|produces|verifies):' "$file" || true
  printf "\n%sFull content:%s\n" "$C_DIM" "$C_RESET"
  cat "$file"
}

stack_seed_resolve() {
  local name=$1
  local dir
  dir=$(stack_seed_dir)
  for ext in sql ts sh; do
    if [[ -f "$dir/$name.$ext" ]]; then
      printf "%s/%s.%s" "$dir" "$name" "$ext"
      return 0
    fi
    if [[ -f "$dir/$name" ]] && [[ "$name" == *.$ext ]]; then
      printf "%s/%s" "$dir" "$name"
      return 0
    fi
  done
  stack_die "seed not found: $name (looked in $dir)"
  return 1
}

stack_seed_apply() {
  local name=$1
  local file
  file=$(stack_seed_resolve "$name") || return 1

  # Verify idempotent declaration.
  local idempotent
  idempotent=$(grep -E '^[ -]*@idempotent:' "$file" | head -1 | sed 's/.*@idempotent:[[:space:]]*//')
  if [[ "$idempotent" != "true" ]]; then
    stack_die "scenario '$name' is not declared @idempotent: true — refused"
    return 1
  fi

  # Verify stack is up.
  local profile svc_db
  profile=$(stack_default_profile)
  svc_db=$(stack_service_db)
  if ! stack_compose "$profile" ps "$svc_db" --status running >/dev/null 2>&1; then
    stack_die "database container '$svc_db' not running — \`stack up\` first"
    return 1
  fi

  local db_user db_name
  db_user=$(stack_db_user)
  db_name=$(stack_db_name)

  # Apply by extension
  case "$file" in
    *.sql)
      stack_info "Applying SQL scenario: $name"
      stack_compose "$profile" exec -T "$svc_db" psql -U "$db_user" -d "$db_name" -v ON_ERROR_STOP=1 < "$file"
      ;;
    *.sh)
      stack_info "Running shell scenario: $name"
      # Provide DATABASE_URL via the compose'd db_port.
      [[ -f "$STACK_REPO_ROOT/infra/.ports" ]] && { set -a; source "$STACK_REPO_ROOT/infra/.ports"; set +a; }
      DATABASE_URL="postgres://${db_user}:$(stack_db_default_pass)@localhost:${STACK_PORT_DB}/${db_name}" \
        bash "$file"
      ;;
    *.ts)
      stack_info "Running TS scenario: $name"
      [[ -f "$STACK_REPO_ROOT/infra/.ports" ]] && { set -a; source "$STACK_REPO_ROOT/infra/.ports"; set +a; }
      ( cd "$STACK_REPO_ROOT" && \
        DATABASE_URL="postgres://${db_user}:$(stack_db_default_pass)@localhost:${STACK_PORT_DB}/${db_name}" \
        pnpm exec tsx "$file" )
      ;;
    *)
      stack_die "unsupported seed type: $file"
      return 1
      ;;
  esac

  stack_ok "Applied scenario: $name"

  # Run verifier
  local verifier_sql
  verifier_sql=$(awk '/@verifies:/,/^[^-]/' "$file" | grep -v '@verifies' | grep -v '^--' | grep -v '^[[:space:]]*$' | head -10)
  if [[ -n "$verifier_sql" ]]; then
    stack_info "Verifying scenario state..."
    local count
    count=$(stack_compose "$profile" exec -T "$svc_db" psql -U "$db_user" -d "$db_name" -tA -c "$verifier_sql" 2>/dev/null | head -1)
    if [[ -z "$count" ]] || [[ "$count" == "0" ]] || [[ "$count" == "f" ]]; then
      stack_warn "verifier returned empty/false — scenario may not have taken"
    else
      stack_ok "Verifier passed: $count"
    fi
  fi

  # Log
  local ts slug worktree
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  slug=$(stack_project_slug)
  worktree=$(stack_current_worktree)
  printf '{"ts":"%s","project":"%s","worktree":"%s","scenario":"%s","verdict":"applied"}\n' \
    "$ts" "$slug" "$worktree" "$name" >> "$STACK_SEED_LOG"
}

stack_seed_reset() {
  local profile svc_db db_user db_name
  profile=$(stack_default_profile)
  svc_db=$(stack_service_db)
  db_user=$(stack_db_user)
  db_name=$(stack_db_name)

  local dir reset_file
  dir=$(stack_seed_dir)
  reset_file="$dir/_reset.sql"

  if [[ ! -f "$reset_file" ]]; then
    stack_warn "no $reset_file — nothing to reset"
    return 0
  fi

  stack_info "Truncating tables per _reset.sql..."
  stack_compose "$profile" exec -T "$svc_db" psql -U "$db_user" -d "$db_name" < "$reset_file"

  # Re-apply system + fixture scenarios.
  for f in "$dir"/00-*.sql "$dir"/10-*.sql; do
    [[ -f "$f" ]] || continue
    local n
    n=$(basename "$f" .sql)
    stack_seed_apply "$n" || true
  done
}

stack_seed_new() {
  local name=$1
  local dir file
  dir=$(stack_seed_dir)
  mkdir -p "$dir"
  file="$dir/$name.sql"
  if [[ -e "$file" ]]; then
    stack_die "already exists: $file"
    return 1
  fi
  cat >"$file" <<EOF
-- @scenario: $name
-- @purpose: TODO — one-line description of what this scenario sets up
-- @idempotent: true
-- @requires:
-- @produces: TODO — what state exists after applying
-- @verifies:
--   SELECT 1 FROM <table> WHERE <condition>;

-- Use idempotent constructs only:
--   INSERT INTO foo (id, name) VALUES ('a', 'b') ON CONFLICT (id) DO NOTHING;
--   UPDATE foo SET name='b' WHERE id='a';
EOF
  stack_ok "Scaffolded $file"
  stack_info "Next: edit the header (purpose, requires, produces, verifies), then write the body."
}
