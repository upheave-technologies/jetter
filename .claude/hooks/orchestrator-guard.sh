#!/bin/bash
# =============================================================================
# Orchestrator Guard - PreToolUse Hook
# =============================================================================
# Prevents the main conversation (orchestrator) from writing source code.
# Source code must be written by specialized agents (donnie, nexus, frankie, etc.).
#
# The orchestrator IS allowed to write:
#   - Documentation: .md, .mdx, .txt
#   - Scripts: .sh
#   - Configuration: .json, .yaml, .yml, .toml, .ini, .cfg, .conf
#   - Environment: .env, .env.*
#   - Lock files: .lock
#
# Detection: When agent_type is absent from the hook input JSON,
# the hook is running in the main conversation (empirically verified).
# =============================================================================

set -euo pipefail

INPUT=$(cat)

# If agent_type is present, this is a subagent — let it through.
# Agent-specific guards (architecture-guard, frankie-scope-guard) handle those.
AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // empty')
if [ -n "$AGENT_TYPE" ]; then
  exit 0
fi

# Main conversation — check if this is a source code file
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Allow non-source files (documentation, scripts, config)
case "$FILE_PATH" in
  *.md|*.mdx|*.txt|*.sh|*.json|*.yaml|*.yml|*.toml|*.ini|*.cfg|*.conf|*.env|*.env.*|*.lock)
    exit 0
    ;;
esac

# Everything else is source code — block the orchestrator
jq -n \
  --arg fp "$FILE_PATH" \
  '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: (
        "ORCHESTRATOR GUARD — SOURCE CODE BLOCKED\n\n" +
        "File: " + $fp + "\n\n" +
        "The orchestrator must NOT write source code directly.\n" +
        "Delegate to the appropriate agent:\n" +
        "  - donnie: backend DDD (domain, application, infrastructure, API routes)\n" +
        "  - nexus: server components, server actions, auth, middleware\n" +
        "  - frankie: React components, JSX, styling, design system\n" +
        "  - archie: database schema, migrations\n\n" +
        "Use the Agent tool with the correct subagent_type."
      )
    }
  }'
exit 0
