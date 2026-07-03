#!/bin/bash

# Version: 2
# =============================================================================
# Nucleus Guard - PreToolUse Hook
# =============================================================================
# Prevents agents from writing to the packages/ directory.
#
# The packages/ directory is nucleus-owned infrastructure. It is read-only in
# every consuming repository — files there are installed and versioned by the
# nucleus repository itself. Any change must flow through `nucleus update`.
#
# Business domain modules belong in modules/, not packages/.
#
# This hook fires on every Edit and Write tool call. It resolves the target
# file path against $CLAUDE_PROJECT_DIR and denies any write whose resolved
# path starts with $PROJECT_DIR/packages/.
#
# Fast path exits:
#   - Tool is not Edit or Write    → exit 0 immediately
#   - file_path is empty           → exit 0
# =============================================================================

set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

# Fast path: only intercept Edit and Write
if [ "$TOOL_NAME" != "Edit" ] && [ "$TOOL_NAME" != "Write" ]; then
  exit 0
fi

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Resolve project root — fall back to CWD if the env var is absent
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# =============================================================================
# Helpers
# =============================================================================

deny() {
  local reason="$1"
  jq -n \
    --arg reason "$reason" \
    '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: $reason
      }
    }'
  exit 0
}

# =============================================================================
# Resolve the target path to an absolute path
# =============================================================================

if [[ "$FILE_PATH" = /* ]]; then
  RESOLVED_PATH="$FILE_PATH"
else
  RESOLVED_PATH="${PROJECT_DIR}/${FILE_PATH}"
fi

# =============================================================================
# Block all writes under packages/
# =============================================================================

if [[ "$RESOLVED_PATH" = "${PROJECT_DIR}/packages/"* ]]; then
  deny "NUCLEUS GUARD — READ-ONLY packages/ DIRECTORY

File: ${FILE_PATH}

The packages/ directory is nucleus-owned infrastructure and is READ-ONLY
in this repository. Two reasons this write is blocked:

  1. Package files are installed and versioned by the nucleus repository.
     To modify a file under packages/, make the change in the nucleus
     repository (the source of truth) and then run \`nucleus update\`
     in this repository to receive the updated file.

  2. If you are adding new business domain code, it does NOT belong in
     packages/. Place new modules under modules/ instead.

Do NOT write to packages/ directly."
fi

# =============================================================================
# All checks passed — path is not nucleus-managed
# =============================================================================

exit 0
