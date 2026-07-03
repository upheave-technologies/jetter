#!/usr/bin/env bash
# =============================================================================
# lifecycle.sh — Manifest-driven lifecycle hooks for the Nucleus Stack Kit
# =============================================================================
# Reads `lifecycle.<phase>` from infra/_kit/manifest.yaml and runs each step,
# in declaration order, against the running stack. This is how a project
# declares its bootstrap recipe (migrate, seed, prime cache, etc.) without
# leaking imperative knowledge into the kit's `stack up`.
#
# Schema (lives in manifest.yaml):
#
#   lifecycle:
#     post_up:                              # runs after `stack up`, before final report
#       <step_name>:
#         exec: <command>                   # required — runs inside the app container
#         workdir: <path>                   # optional — docker compose exec -w <path>
#         env: KEY=VAL [KEY=VAL ...]        # optional — docker compose exec -e KEY=VAL
#         on_failure: abort|continue        # optional — default 'abort'
#         description: <text>               # optional — printed in the run header
#     pre_down: { ... }                     # runs before `stack down`
#
# Contract:
#   - Steps are idempotent (rerunning `stack up` re-runs them safely).
#   - A non-zero exit aborts the chain unless on_failure: continue.
#   - The kit logs every step's duration + exit code to ~/.stack/lifecycle-log.jsonl.
#   - Run with --no-hooks to skip lifecycle for a single up/down.
# =============================================================================

[[ -n "${_STACK_LIFECYCLE_LOADED:-}" ]] && return 0
_STACK_LIFECYCLE_LOADED=1

# shellcheck source=./_common.sh
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
# shellcheck source=./compose.sh
source "$(dirname "${BASH_SOURCE[0]}")/compose.sh"

STACK_LIFECYCLE_LOG=${STACK_LIFECYCLE_LOG:-$STACK_HOME/lifecycle-log.jsonl}

# Run all hook steps declared under lifecycle.<phase>.
# Returns 0 if every step succeeded (or was skipped per on_failure: continue),
# non-zero if any step aborted the chain.
#
# Args:
#   $1  phase  e.g. "post_up", "pre_down"
stack_lifecycle_run() {
  local phase=$1

  local steps
  steps=$(stack_manifest_keys "lifecycle.$phase")
  if [[ -z "$steps" ]]; then
    return 0
  fi

  local profile svc_app
  profile=$(stack_default_profile)
  svc_app=$(stack_service_app)

  local step_count
  step_count=$(printf "%s\n" "$steps" | grep -c .)
  stack_step "Lifecycle: $phase ($step_count step$([[ $step_count -ne 1 ]] && echo s))"

  # Read step names into an array up-front. We can't iterate `while read`
  # because `docker compose exec` inside the loop body consumes the loop's
  # stdin and silently terminates iteration after step 1.
  local -a steps_array=()
  local s
  while IFS= read -r s; do
    [[ -n "$s" ]] && steps_array+=("$s")
  done <<< "$steps"

  local overall_rc=0
  local idx=0
  for step in "${steps_array[@]}"; do
    idx=$(( idx + 1 ))

    local cmd workdir env_str on_failure description
    cmd=$(stack_manifest "lifecycle.$phase.$step.exec")
    workdir=$(stack_manifest "lifecycle.$phase.$step.workdir")
    env_str=$(stack_manifest "lifecycle.$phase.$step.env")
    on_failure=$(stack_manifest "lifecycle.$phase.$step.on_failure" "abort")
    description=$(stack_manifest "lifecycle.$phase.$step.description")

    if [[ -z "$cmd" ]]; then
      stack_warn "[$idx/$step_count] $step — no 'exec:' command declared, skipping."
      continue
    fi

    # Pretty header.
    local title="$step"
    [[ -n "$description" ]] && title="$step — $description"
    printf "\n  %s%s[%d/%d]%s %s%s%s\n" \
      "${C_DIM}" "" "$idx" "$step_count" "${C_RESET}" \
      "${C_BOLD}" "$title" "${C_RESET}"
    printf "  %s$ %s%s\n" "${C_DIM}" "$cmd" "${C_RESET}"
    [[ -n "$workdir" ]] && printf "  %s  (workdir: %s)%s\n" "${C_DIM}" "$workdir" "${C_RESET}"
    [[ -n "$env_str" ]] && printf "  %s  (env: %s)%s\n" "${C_DIM}" "$env_str" "${C_RESET}"

    # Build the docker compose exec invocation.
    # We pass `-T` for non-TTY (so output streams cleanly), `-e KEY=VAL` for each
    # env entry, and `-w <path>` for workdir. The command itself is passed via
    # `sh -c "..."` so users can use shell features (chains, env, redirects).
    local -a exec_args=( "-T" )
    if [[ -n "$workdir" ]]; then
      exec_args+=( "-w" "$workdir" )
    fi
    if [[ -n "$env_str" ]]; then
      # env_str is a space-separated string of KEY=VAL pairs.
      for pair in $env_str; do
        exec_args+=( "-e" "$pair" )
      done
    fi

    local start_ts end_ts duration_ms step_rc=0
    start_ts=$(python3 -c 'import time;print(int(time.time()*1000))')
    stack_compose "$profile" exec "${exec_args[@]}" "$svc_app" sh -c "$cmd" || step_rc=$?
    end_ts=$(python3 -c 'import time;print(int(time.time()*1000))')
    duration_ms=$(( end_ts - start_ts ))

    # Append to lifecycle log.
    local ts slug worktree
    ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    slug=$(stack_project_slug)
    worktree=$(stack_current_worktree)
    printf '{"ts":"%s","project":"%s","worktree":"%s","phase":"%s","step":"%s","duration_ms":%d,"exit_code":%d}\n' \
      "$ts" "$slug" "$worktree" "$phase" "$step" "$duration_ms" "$step_rc" >> "$STACK_LIFECYCLE_LOG"

    if (( step_rc != 0 )); then
      printf "  %s✗%s %s failed in %dms (exit %d)\n" \
        "${C_RED}" "${C_RESET}" "$step" "$duration_ms" "$step_rc"
      if [[ "$on_failure" == "continue" ]]; then
        stack_hint "on_failure=continue → moving on to the next step."
        overall_rc=$step_rc
      else
        stack_hint "on_failure=abort (default) → stopping the chain."
        stack_hint "Inspect with:  stack logs $svc_app --since 5m"
        stack_hint "Run a single step ad-hoc:  stack exec $cmd"
        return "$step_rc"
      fi
    else
      printf "  %s✓%s %s done in %dms\n" \
        "${C_GREEN}" "${C_RESET}" "$step" "$duration_ms"
    fi
  done

  return "$overall_rc"
}

# Show lifecycle hooks declared in the manifest. Read-only.
stack_lifecycle_list() {
  printf "\n%sLifecycle hooks declared in %s%s\n" \
    "${C_BOLD}" "$(stack_manifest_file)" "${C_RESET}"
  for phase in post_up pre_down; do
    local steps
    steps=$(stack_manifest_keys "lifecycle.$phase")
    if [[ -z "$steps" ]]; then
      printf "\n  %s%s%s: (none)\n" "${C_DIM}" "$phase" "${C_RESET}"
      continue
    fi
    printf "\n  %s%s%s\n" "${C_BOLD}" "$phase" "${C_RESET}"
    local idx=0
    while IFS= read -r step; do
      [[ -z "$step" ]] && continue
      idx=$(( idx + 1 ))
      local cmd workdir env_str on_failure
      cmd=$(stack_manifest "lifecycle.$phase.$step.exec")
      workdir=$(stack_manifest "lifecycle.$phase.$step.workdir")
      env_str=$(stack_manifest "lifecycle.$phase.$step.env")
      on_failure=$(stack_manifest "lifecycle.$phase.$step.on_failure" "abort")
      printf "    %d. %s\n" "$idx" "$step"
      printf "       %sexec:%s %s\n" "${C_DIM}" "${C_RESET}" "$cmd"
      [[ -n "$workdir" ]] && printf "       %sworkdir:%s %s\n" "${C_DIM}" "${C_RESET}" "$workdir"
      [[ -n "$env_str" ]] && printf "       %senv:%s %s\n" "${C_DIM}" "${C_RESET}" "$env_str"
      printf "       %son_failure:%s %s\n" "${C_DIM}" "${C_RESET}" "$on_failure"
    done <<< "$steps"
  done
  printf "\n"
}
