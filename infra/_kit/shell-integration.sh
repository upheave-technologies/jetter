# =============================================================================
# Nucleus Stack Kit — shell integration
# =============================================================================
# Source this file from your shell rc (~/.zshrc, ~/.bashrc) to make the `stack`
# command available from any subdirectory of any stack-equipped project.
#
# Installed at ~/.stack/shell-integration.sh by `stack install-shell` so the
# rc line is stable (the kit can update this file later without touching rc).
#
# Recommended rc line (added automatically by `stack install-shell`):
#   [[ -f ~/.stack/shell-integration.sh ]] && source ~/.stack/shell-integration.sh
# =============================================================================

# stack — auto-discover and invoke the Stack CLI for the current project.
# Walks up from $PWD looking for infra/_kit/bin/stack and execs it.
# Works from the repo root, from any subdirectory, and switches automatically
# when you cd between stack-equipped projects.
stack() {
  local dir="$PWD"
  while [[ "$dir" != "/" && "$dir" != "" ]]; do
    if [[ -x "$dir/infra/_kit/bin/stack" ]]; then
      "$dir/infra/_kit/bin/stack" "$@"
      return $?
    fi
    dir="$(dirname "$dir")"
  done
  echo "stack: not inside an stack-equipped project (no infra/_kit/bin/stack found walking up from $PWD)" >&2
  echo "  → cd to a kit-equipped repo, or run /infra-bootstrap to install the kit here." >&2
  return 1
}

# Optional: zsh tab-completion for `stack` subcommands. Only loads under zsh.
if [[ -n "${ZSH_VERSION:-}" ]]; then
  _omega_stack_complete() {
    local -a subcmds
    subcmds=(
      'up:boot the local stack'
      'down:stop the local stack'
      'restart:restart core or named service'
      'reset:wipe containers + volumes'
      'ps:show running services'
      'ports:show port allocation'
      'doctor:diagnose environment'
      'logs:tail container logs'
      'psql:open psql against local DB'
      'exec:run a command inside the app container'
      'seed:scenario seed runner'
      'tls:mkcert-based local HTTPS'
      'lifecycle:manifest-driven bootstrap hooks'
      'dashboard:cross-project tracker'
      'tunnel:expose locally for webhook testing'
      'triage:production triage'
      'help:show all commands'
    )
    _describe 'stack subcommand' subcmds
  }
  compdef _omega_stack_complete stack 2>/dev/null || true
fi
