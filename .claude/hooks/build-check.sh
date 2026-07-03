#!/bin/bash
# =============================================================================
# Build Check - Stop Hook
# =============================================================================
# Runs TypeScript check before the orchestrator returns to the user.
# If the build fails, blocks Claude and instructs it to delegate fixes
# to the appropriate agent using Memory Bridge for context.
#
# Registered in .claude/settings.json as a Stop hook.
#
# Behavior:
#   - Skips if no code files were changed (git status check)
#   - First failure (stop_hook_active=false): BLOCKS with fix instructions
#   - Second failure (stop_hook_active=true): WARNS but allows stop
#   - This prevents infinite loops while still catching errors
# =============================================================================

set -eo pipefail

INPUT=$(cat)
STOP_HOOK_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false')

# =============================================================================
# Resolve working directory — must run where code was actually produced
# =============================================================================
# When agents work in a git worktree, $CLAUDE_PROJECT_DIR points to the main
# repo, NOT the worktree. We use `cwd` from the hook input and resolve the
# git root from there, which correctly returns the worktree root.
# =============================================================================

CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

if [ -n "$CWD" ] && [ -d "$CWD" ]; then
  PROJECT_ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null || echo "$CLAUDE_PROJECT_DIR")
else
  PROJECT_ROOT="$CLAUDE_PROJECT_DIR"
fi

cd "$PROJECT_ROOT"

# =============================================================================
# Check for code changes - skip if no code files were modified
# =============================================================================

HAS_CHANGES=$(git status --porcelain 2>/dev/null | grep -E '\.(ts|tsx|js|jsx|css|prisma)$' || true)

if [ -z "$HAS_CHANGES" ]; then
  exit 0
fi

# =============================================================================
# Run TypeScript check
# =============================================================================

set +e
# tsc with brutal flags:
#   --noEmit                 type-check only, no .js output
#   --noUnusedLocals         flag unused local vars/imports (TS6133)
#   --noUnusedParameters     flag unused function params (TS6133)
# These enforce Commandment XI from donnie-rules.md §7.11 — no dead code
# in shipped work. Prefix params with `_` if intentionally unused.
BUILD_OUTPUT=$(pnpm tsc --noEmit --noUnusedLocals --noUnusedParameters 2>&1)
BUILD_EXIT=$?
set -e

# Build passed — now check capability drift
if [ "$BUILD_EXIT" -eq 0 ]; then
  # Only check if use case files were changed
  HAS_USECASE_CHANGES=$(echo "$HAS_CHANGES" | grep -E 'UseCase\.(ts|tsx)$' || true)

  if [ -n "$HAS_USECASE_CHANGES" ] && grep -q '"scenarios:generate:check"' "$PROJECT_ROOT/package.json" 2>/dev/null; then
    set +e
    CAPABILITY_OUTPUT=$(pnpm scenarios:generate:check 2>&1)
    CAPABILITY_EXIT=$?
    set -e

    if [ "$CAPABILITY_EXIT" -ne 0 ]; then
      # Capability drift detected
      if [ "$STOP_HOOK_ACTIVE" = "true" ]; then
        jq -n --arg errors "$CAPABILITY_OUTPUT" --arg root "$PROJECT_ROOT" '{
          systemMessage: ("⚠️ Capability drift detected in " + $root + ". Capabilities may be stale:\n\n" + $errors)
        }'
        exit 0
      fi

      jq -n --arg errors "$CAPABILITY_OUTPUT" --arg files "$HAS_USECASE_CHANGES" --arg root "$PROJECT_ROOT" '{
        decision: "block",
        reason: (
          "CAPABILITY DRIFT — Use case files changed but capabilities.yml is stale.\n\n" +
          "Working directory: " + $root + "\n\n" +
          "```\n" + $errors + "\n```\n\n" +
          "Changed use case files:\n" + $files + "\n\n" +
          "INSTRUCTIONS:\n\n" +
          "1. Review the .capability.ts sidecar for each drifted use case\n" +
          "2. Update preconditions and effects if the use case behavior changed\n" +
          "3. Run: pnpm scenarios:generate\n" +
          "4. This regenerates capabilities.yml with fresh hashes\n\n" +
          "Delegate to the appropriate agent if sidecar updates are needed."
        )
      }'
      exit 0
    fi
  fi

  # All checks passed
  exit 0
fi

# =============================================================================
# Build failed - decide whether to block or warn
# =============================================================================

# Truncate output if too long
if [ ${#BUILD_OUTPUT} -gt 3000 ]; then
  BUILD_OUTPUT="${BUILD_OUTPUT:0:3000}
... (truncated, showing first 3000 chars)"
fi

# Get changed files for context
CHANGED_FILES=$(git status --porcelain 2>/dev/null | grep -E '\.(ts|tsx|js|jsx|css|prisma)$' | sed 's/^...//' || true)

# --- Already retried once → warn but allow stop ---
if [ "$STOP_HOOK_ACTIVE" = "true" ]; then
  jq -n --arg errors "$BUILD_OUTPUT" --arg root "$PROJECT_ROOT" '{
    systemMessage: ("⚠️ TypeScript errors persist after fix attempt in " + $root + ". Inform the user of remaining errors:\n\n" + $errors)
  }'
  exit 0
fi

# --- First failure → block and instruct to fix ---
jq -n --arg errors "$BUILD_OUTPUT" --arg files "$CHANGED_FILES" --arg root "$PROJECT_ROOT" '{
  decision: "block",
  reason: (
    "BUILD CHECK FAILED — TypeScript errors detected before returning to user.\n\n" +
    "Working directory: " + $root + "\n\n" +
    "```\n" + $errors + "\n```\n\n" +
    "Changed files:\n" + $files + "\n\n" +
    "INSTRUCTIONS:\n\n" +
    "If these errors are from INCOMPLETE work (another agent still needs to run):\n" +
    "→ Continue to the next step. The check runs again when you finish.\n\n" +
    "If these errors are from COMPLETED work that needs fixing:\n" +
    "1. Identify which file(s) have errors and which agent owns them\n" +
    "2. Delegate the fix to the appropriate agent via Task tool\n" +
    "3. CRITICAL — Use Memory Bridge in your prompt to the agent:\n" +
    "   ANCHOR: What task/feature is being built and the goal\n" +
    "   PROGRESS: What files were created/modified (include relevant snippets)\n" +
    "   DELTA: The TypeScript errors shown above\n" +
    "   INSTRUCTION: Fix ONLY the listed errors. Do NOT modify other working code.\n\n" +
    "DO NOT fix code yourself. ALWAYS delegate to the appropriate agent."
  )
}'
exit 0
