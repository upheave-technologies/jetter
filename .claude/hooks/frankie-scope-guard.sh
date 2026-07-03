#!/bin/bash
# =============================================================================
# Frankie Scope Guard - PreToolUse Hook
# =============================================================================
# This hook runs BEFORE Frankie tries to Edit or Write a file.
# It blocks edits to files outside Frankie's presentational domain.
#
# ALLOWED (Frankie's domain):
#   - app/*/_components/**/*.tsx   (route-specific presentational components)
#   - app/*/_containers/**/*.tsx   (route-specific container components)
#   - components/ui/**/*.tsx       (shared design system components)
#   - app/**/page.tsx              (to replace `return null` with JSX only)
#   - app/**/error.tsx             (to add JSX to error boundaries)
#   - app/**/loading.tsx           (to add JSX to loading states)
#   - app/**/not-found.tsx         (to add JSX to 404 pages)
#
# BLOCKED (Other agents' domains):
#   - app/**/actions.ts            (nexus - Server Actions)
#   - app/**/layout.tsx            (protected - explicit request only)
#   - app/api/**/*                 (donnie - API routes)
#   - modules/**/*                 (donnie - backend DDD)
#   - prisma/**/*                  (archie - database schema)
#   - middleware.ts                (nexus - route guards)
#   - *.spec.ts                    (spectre - design specs, read-only)
#
# Exit codes:
#   0 = Allow the edit
#   2 = Block the edit (stderr message goes to Claude as feedback)
# =============================================================================

set -e

# Read JSON input from stdin
INPUT=$(cat)

# Agent-type gating: only enforce for frankie
AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // empty')
if [ "$AGENT_TYPE" != "frankie" ]; then
  exit 0
fi

# Extract the file path from tool_input
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# If no file path, allow (shouldn't happen for Edit/Write)
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# =============================================================================
# BLOCKED PATTERNS - Files Frankie must NEVER touch
# =============================================================================

# Server Actions (nexus's domain)
if [[ "$FILE_PATH" == */actions.ts ]] || [[ "$FILE_PATH" == */actions.tsx ]]; then
  cat >&2 << 'EOF'
🛑 SCOPE VIOLATION: Server Actions are Nexus's domain

You attempted to edit: actions.ts
This file contains Server Actions which are handled by the nexus agent.

Follow the Gap Protocol:
1. DO NOT halt - continue building the UI
2. Create a stub action in your Container:
   const stubAction = async () => {}
   // FIXME: Nexus missing action - [describe what's needed]
3. Bind the stub to your component
4. Document this gap in your Implementation Report under "Missing Dependencies"

Nexus will implement the actual Server Action later.
EOF
  exit 2
fi

# Layout files (protected unless explicitly requested)
if [[ "$FILE_PATH" == */layout.tsx ]]; then
  cat >&2 << 'EOF'
🛑 SCOPE VIOLATION: Layout files are protected

You attempted to edit: layout.tsx
Layout modifications require explicit user request.

Follow the Gap Protocol:
1. DO NOT modify the layout
2. Work within the existing layout structure
3. If layout changes are truly needed, flag this in your Implementation Report
4. The orchestrator will request layout changes explicitly if approved

Continue building your components within the current layout constraints.
EOF
  exit 2
fi

# API routes (donnie's domain)
if [[ "$FILE_PATH" == *app/api/* ]]; then
  cat >&2 << 'EOF'
🛑 SCOPE VIOLATION: API routes are Donnie's domain

You attempted to edit a file in: app/api/
API routes and backend endpoints are handled by the donnie agent.

Follow the Gap Protocol:
1. DO NOT halt - continue building the UI
2. Define the expected data interface/props
3. Pass null/undefined for missing data in page.tsx
4. Add comment: // FIXME: Nexus missing data - [describe what's needed]
5. Document this gap in your Implementation Report

Donnie will implement the API endpoint. Nexus will wire up the data fetching.
EOF
  exit 2
fi

# Backend modules (donnie's domain)
if [[ "$FILE_PATH" == *modules/* ]]; then
  cat >&2 << 'EOF'
🛑 SCOPE VIOLATION: Backend modules are Donnie's domain

You attempted to edit a file in: modules/
The DDD backend architecture (domain, application, infrastructure layers) is handled by the donnie agent.

Follow the Gap Protocol:
1. DO NOT halt - continue building the UI
2. Define the expected data interface/props
3. Use stub data or pass null for missing data
4. Add comment: // FIXME: Backend missing - [describe what's needed]
5. Document this gap in your Implementation Report

Donnie implements backend logic. You implement the visual presentation.
EOF
  exit 2
fi

# Prisma schema (archie's domain)
if [[ "$FILE_PATH" == *prisma/* ]]; then
  cat >&2 << 'EOF'
🛑 SCOPE VIOLATION: Database schema is Archie's domain

You attempted to edit a file in: prisma/
Database schema and migrations are handled by the archie agent.

This is completely outside your scope. Continue building UI with the data structures that exist.
Document any schema requirements in your Implementation Report.
EOF
  exit 2
fi

# Middleware (nexus's domain)
if [[ "$FILE_PATH" == */middleware.ts ]] || [[ "$FILE_PATH" == */middleware.tsx ]]; then
  cat >&2 << 'EOF'
🛑 SCOPE VIOLATION: Middleware is Nexus's domain

You attempted to edit: middleware.ts
Route guards and middleware are handled by the nexus agent.

Continue building your presentational components. Middleware concerns are not your responsibility.
EOF
  exit 2
fi

# Design specs (spectre's output - read only for Frankie)
if [[ "$FILE_PATH" == *.spec.ts ]]; then
  cat >&2 << 'EOF'
🛑 SCOPE VIOLATION: Design specs are read-only

You attempted to edit a .spec.ts file.
Design specifications are created by the spectre agent and are READ-ONLY for you.

Your job is to IMPLEMENT the spec, not modify it.
If the spec is unclear or incorrect, flag this in your Implementation Report.
EOF
  exit 2
fi

# =============================================================================
# ALLOWED PATTERNS - Frankie's domain
# =============================================================================

# _components folders (Frankie's primary domain)
if [[ "$FILE_PATH" == */_components/* ]]; then
  exit 0
fi

# _containers folders (Frankie's domain)
if [[ "$FILE_PATH" == */_containers/* ]]; then
  exit 0
fi

# Shared UI components (Frankie's domain)
if [[ "$FILE_PATH" == *components/ui/* ]]; then
  exit 0
fi

# Page files (Frankie adds JSX to Nexus's data layer)
if [[ "$FILE_PATH" == */page.tsx ]]; then
  # Allow, but the agent instructions tell Frankie to preserve data logic
  exit 0
fi

# Error boundaries (Frankie adds JSX)
if [[ "$FILE_PATH" == */error.tsx ]]; then
  exit 0
fi

# Loading states (Frankie adds JSX)
if [[ "$FILE_PATH" == */loading.tsx ]]; then
  exit 0
fi

# Not found pages (Frankie adds JSX)
if [[ "$FILE_PATH" == */not-found.tsx ]]; then
  exit 0
fi

# Tailwind v4 design tokens / theme — frankie-rules §2 explicitly assigns
# `app/globals.css` to frankie (theme tokens via @theme).
if [[ "$FILE_PATH" == */app/globals.css ]] || [[ "$FILE_PATH" == */globals.css ]]; then
  exit 0
fi

# =============================================================================
# UNKNOWN FILES - Block with guidance
# =============================================================================

# If we get here, the file doesn't match any known pattern
# Block it and ask Frankie to reconsider

cat >&2 << EOF
🛑 SCOPE VERIFICATION FAILED: Unknown file location

You attempted to edit: $FILE_PATH

This file is not in a recognized Frankie domain:
  ✅ app/*/_components/**   - Route-specific components
  ✅ app/*/_containers/**   - Route-specific containers
  ✅ components/ui/**       - Shared design system
  ✅ app/**/page.tsx        - Add JSX (preserve data logic!)
  ✅ app/**/error.tsx       - Error boundary JSX
  ✅ app/**/loading.tsx     - Loading state JSX
  ✅ app/**/not-found.tsx   - 404 page JSX

If this file should be created/modified:
1. Check if it belongs in _components/ or _containers/
2. Check if another agent should handle it
3. Document the issue in your Implementation Report

When in doubt, create files in _components/ or _containers/ folders.
EOF
exit 2
