#!/bin/bash
# =============================================================================
# Auditor Trigger - Stop Hook
# =============================================================================
# Mechanically enforces that the architectural auditor runs after any
# *real, in-session* code-bearing work by the main orchestrator. When such
# changes are detected, blocks the stop and instructs Claude to dispatch
# the `auditor` subagent before continuing.
#
# Detection model:
#   We parse the conversation transcript (transcript_path) and look at tool
#   uses *since the last auditor dispatch* (or session start, if none yet).
#   Triggers if any of those are:
#     - Edit / Write / MultiEdit on a file with a code extension
#     - NotebookEdit on a code-extension notebook path
#     - Agent / Task dispatch to a code-writing subagent
#       (donnie | nexus | frankie | archie)
#
#   We do NOT use `git status --porcelain` — that captures pre-existing
#   dirty files from before the conversation began, which produced false
#   positives on every Stop.
#
# What this hook deliberately ignores:
#   - Pure documentation edits (.md, .mdx)
#   - Config-only edits (.json, .yml, .yaml, .toml, etc.)
#   - Read-only sessions
#   - Edits made in subagent-internal turns (SubagentStop is a separate
#     hook and is intentionally not wired)
#
# Mechanical correctness (tsc) is enforced by build-check.sh — a sister
# Stop hook. This hook handles architectural review only.
#
# Behavior:
#   - Skips on re-stop (stop_hook_active=true) — already in audit loop
#   - Skips when transcript shows no code-bearing tool uses since last audit
#   - Otherwise: BLOCKS, instructs Claude to dispatch auditor
# =============================================================================

set -eo pipefail

INPUT=$(cat)
STOP_HOOK_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false')

# Note on re-stop behavior:
#   We do NOT exit silently on stop_hook_active=true. The cursor logic below
#   already handles re-stops correctly: if the auditor was dispatched since
#   the last code-bearing tool use, the cursor moves past it and CHANGED_ITEMS
#   is empty (silent exit). If the auditor was NOT dispatched but the
#   orchestrator retries stop anyway, the cursor stays put and CHANGED_ITEMS
#   is still populated (block again). This prevents bypass-by-retry.
#
#   Brutally rigorous: every code-bearing change-unit produces an auditor
#   card before stop is allowed. No exceptions.

TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')

# Without a transcript we cannot scope detection to this session — exit silent
# rather than risk false positives from working-tree state.
if [ -z "$TRANSCRIPT_PATH" ] || [ ! -f "$TRANSCRIPT_PATH" ]; then
  exit 0
fi

# =============================================================================
# Cursor: most recent line where the orchestrator dispatched the auditor.
# We only care about tool uses AFTER that point (or whole session if none yet).
# =============================================================================
CURSOR_LINE=$( { grep -n '"subagent_type":"auditor"' "$TRANSCRIPT_PATH" 2>/dev/null || true; } \
  | tail -1 \
  | cut -d: -f1)

if [ -z "$CURSOR_LINE" ]; then
  CURSOR_LINE=0
fi

# =============================================================================
# Scan transcript from cursor for code-bearing tool uses.
# =============================================================================
CODE_EXT_PATTERN='\.(ts|tsx|js|jsx|mjs|cjs|css|scss|prisma|sql|py|go|rs|rb|java|kt|swift)$'
CODE_AGENT_PATTERN='^(donnie|nexus|frankie|archie)$'

CHANGED_ITEMS=$(tail -n +$((CURSOR_LINE + 1)) "$TRANSCRIPT_PATH" 2>/dev/null \
  | jq -r --arg extRe "$CODE_EXT_PATTERN" --arg agentRe "$CODE_AGENT_PATTERN" '
      select(.type == "assistant")
      | .message.content[]?
      | select(.type == "tool_use")
      | (
          if (.name == "Edit" or .name == "Write" or .name == "MultiEdit") then
            (.input.file_path // "")
          elif (.name == "NotebookEdit") then
            (.input.notebook_path // "")
          elif ((.name == "Agent" or .name == "Task")
                and ((.input.subagent_type // "") | test($agentRe))) then
            ("[agent:" + .input.subagent_type + "]")
          else
            empty
          end
        )
      | select(. != "")
      | select(test($extRe) or startswith("[agent:"))
    ' 2>/dev/null \
  | awk '!seen[$0]++' \
  | head -10)

if [ -z "$CHANGED_ITEMS" ]; then
  exit 0
fi

# =============================================================================
# Code-bearing changes present this session — block and instruct.
# =============================================================================
jq -n --arg files "$CHANGED_ITEMS" '{
  decision: "block",
  reason: (
    "ARCHITECTURAL AUDIT REQUIRED — code-bearing changes detected this session, auditor has not run since.\n\n" +
    "Code-bearing tool uses since last audit:\n" + $files + "\n\n" +
    "INSTRUCTIONS:\n" +
    "1. Dispatch the `auditor` subagent now via the Task tool (subagent_type: \"auditor\").\n" +
    "2. Pass the auditor a brief context line and let it read the diff itself.\n" +
    "3. Surface the returned card to the user.\n" +
    "4. Then you may stop.\n\n" +
    "The auditor reviews architectural correctness only — rules, axioms, layer boundaries, idiom. " +
    "It does not run tests or verify functional correctness. Mechanical (tsc) is handled by build-check.sh separately.\n\n" +
    "This is reflexive: every implementation pass produces an architectural review. No exceptions."
  )
}'
exit 0
