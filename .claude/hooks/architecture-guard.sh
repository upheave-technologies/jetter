#!/bin/bash

# Version: 3
# =============================================================================
# Architecture Guard - PreToolUse Hook
# =============================================================================
# Enforces DDD layer boundaries and clean architecture rules.
# Checks the CONTENT being written against rules based on FILE LOCATION.
#
# Deployed in agent frontmatter (frankie, donnie, nexus) so it fires
# for every code-writing agent.
#
# The strict data flow:
#   Frontend (_components, _containers)
#     → Server Actions (actions.ts)
#       → UseCases (application/)
#         → Repositories (infrastructure/repositories/)
#           → External Services (prisma, APIs, storage)
#
# Each layer can ONLY call the layer directly below it. No shortcuts.
#
# Rules:
#   1. Component Purity:        _components/ = pure JSX, NO hooks/state
#   2. ORM / Database Boundary: ORM, db clients, schema ONLY in infrastructure/repositories/
#   3. Action/App Boundary:     app/ files use ONLY useCases, types, session, core
#   4. UseCase Boundary:        useCases: NO orm, NO db, NO schema, NO http
#   5. Frontend Boundary:       components/containers call ONLY server actions
#   6. Service Class Detection: no class XService/Controller/Manager/Handler/Provider
#   7. One UseCase Per File:    application/*UseCase* files contain exactly one make*UseCase
#   8. Domain Layer Purity:     domain/ files cannot import infrastructure/ or application/
#   9. Cross-Module Import Guard: @core modules are blind to each other (Axiom of Isolation)
#  10. Zombie Shield:           repository read queries must include soft-delete filter (WARN)
#  11. Page Component Boundary: page.tsx = server component, single child component, no raw JSX
#  12. 'use client' Containment: 'use client' only in _containers/ or error.tsx
#  13. Server-First Fetching:  useEffect(…,[]) in containers is forbidden — fetch on server
#  14. Client Container Purity: _containers/ with 'use client' = slim state proxy, no raw JSX
# =============================================================================

set -euo pipefail

INPUT=$(cat)

# Agent-type gating: only enforce for donnie, nexus, frankie
AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // empty')
case "$AGENT_TYPE" in
  donnie|nexus|frankie) ;;
  *) exit 0 ;;
esac

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Skip non-source files — architecture rules apply to code, not documentation or config.
# Markdown, YAML, JSON, plain text, and shell scripts are exempt.
case "$FILE_PATH" in
  *.md|*.mdx|*.yml|*.yaml|*.json|*.txt|*.sh|*.env|*.env.*|*.lock|*.toml|*.ini|*.cfg|*.conf)
    exit 0
    ;;
esac

# Extract content being written/edited
if [ "$TOOL_NAME" = "Write" ]; then
  CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // empty')
elif [ "$TOOL_NAME" = "Edit" ]; then
  CONTENT=$(echo "$INPUT" | jq -r '.tool_input.new_string // empty')
else
  exit 0
fi

if [ -z "$CONTENT" ]; then
  exit 0
fi

# =============================================================================
# Helpers
# =============================================================================

deny() {
  local rule="$1"
  local violation="$2"
  local fix="$3"
  jq -n \
    --arg fp "$FILE_PATH" \
    --arg rule "$rule" \
    --arg violation "$violation" \
    --arg fix "$fix" \
    '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: (
          "ARCHITECTURE GUARD — " + $rule + "\n\n" +
          "File: " + $fp + "\n" +
          "Violation: " + $violation + "\n\n" +
          "Required: " + $fix
        )
      }
    }'
  exit 0
}

warn() {
  local rule="$1"
  local violation="$2"
  local fix="$3"
  jq -n \
    --arg fp "$FILE_PATH" \
    --arg rule "$rule" \
    --arg violation "$violation" \
    --arg fix "$fix" \
    '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        permissionDecisionReason: (
          "ARCHITECTURE GUARD WARNING — " + $rule + "\n\n" +
          "File: " + $fp + "\n" +
          "Warning: " + $violation + "\n\n" +
          "Recommended: " + $fix
        )
      }
    }'
  # exit 0 allows the write to proceed
  exit 0
}

# Check content for a pattern (exit 0 = found)
content_has() {
  printf '%s' "$CONTENT" | grep -qE "$1" 2>/dev/null
}

# Get matching lines for error messages
content_matches() {
  printf '%s' "$CONTENT" | grep -nE "$1" 2>/dev/null | head -5 || true
}

# =============================================================================
# Detect architectural layer from file path
# =============================================================================

IS_COMPONENT=false
IS_CONTAINER=false
IS_ACTION=false
IS_USECASE=false
IS_REPOSITORY=false
IS_FRONTEND=false
IS_DOMAIN=false
IS_PAGE=false

IS_ERROR_BOUNDARY=false

if [[ "$FILE_PATH" == */_components/* ]]; then IS_COMPONENT=true; IS_FRONTEND=true; fi
if [[ "$FILE_PATH" == */_containers/* ]]; then IS_CONTAINER=true; IS_FRONTEND=true; fi
if [[ "$FILE_PATH" == */actions.ts ]] || [[ "$FILE_PATH" == */actions.tsx ]]; then IS_ACTION=true; fi
if [[ "$FILE_PATH" == */application/* ]] || [[ "$FILE_PATH" == *use-case* ]] || [[ "$FILE_PATH" == *UseCase* ]]; then IS_USECASE=true; fi
if [[ "$FILE_PATH" == */infrastructure/repositories/* ]] || [[ "$FILE_PATH" == */infrastructure/repository/* ]]; then IS_REPOSITORY=true; fi

# infrastructure/database.ts files are type-only definition files that use
# ReturnType<typeof drizzle<...>> to express the db type contract. This is
# a pure TypeScript type operation, not runtime database access. Exempt from Rule 2.
IS_DATABASE_TYPE_FILE=false
if [[ "$FILE_PATH" == */infrastructure/database.ts ]]; then IS_DATABASE_TYPE_FILE=true; fi

# Module index.ts barrel files re-export schema for consuming apps to compose
# their database instances. This is the intended public API surface — not direct
# database access. Exempt from Rule 2.
IS_INDEX_BARREL=false
if [[ "$FILE_PATH" == */index.ts ]] && [[ "$FILE_PATH" != */infrastructure/* ]] && [[ "$FILE_PATH" != */application/* ]] && [[ "$FILE_PATH" != */domain/* ]]; then IS_INDEX_BARREL=true; fi

# Schema directory files (schema/*.ts) define Drizzle table structures and enums.
# These are the legitimate home for ORM schema definitions — they are NOT runtime
# database access code. They mirror what Prisma's schema.prisma does in the reference.
# Exempt from Rule 2 because schema/ is a dedicated schema-definition layer, not
# application code that is bypassing the repository pattern.
IS_SCHEMA_FILE=false
if [[ "$FILE_PATH" == */schema/*.ts ]]; then IS_SCHEMA_FILE=true; fi

# sdk.ts files at package roots wire repositories and use cases together.
# They are the composition root — they import from infrastructure/repositories/ to
# construct the dependency graph. They do not write queries; they pass db to factories.
# Exempt from Rule 2 (covered by the same rationale as IS_DATABASE_TYPE_FILE).
IS_SDK_FILE=false
if [[ "$FILE_PATH" == */sdk.ts ]]; then IS_SDK_FILE=true; fi
if [[ "$FILE_PATH" == */domain/* ]] && [[ "$FILE_PATH" != *Repository* ]]; then IS_DOMAIN=true; fi
if [[ "$FILE_PATH" == */page.tsx ]]; then IS_PAGE=true; fi
if [[ "$FILE_PATH" == */error.tsx ]]; then IS_ERROR_BOUNDARY=true; fi

IS_API_ROUTE=false
if [[ "$FILE_PATH" == */route.ts ]] || [[ "$FILE_PATH" == */route.tsx ]]; then IS_API_ROUTE=true; fi


# =============================================================================
# RULE 1: Component Purity
# _components/ files must be PURE presentational — no hooks, no state.
# Only exception: useFormStatus (for pending form states)
# =============================================================================

if [ "$IS_COMPONENT" = true ]; then
  HOOK_PATTERN="(useState|useEffect|useReducer|useMemo|useCallback|useRef|useContext|useQuery|useMutation|useTransition|useOptimistic|useRouter|usePathname|useSearchParams|useLayoutEffect)"

  if content_has "$HOOK_PATTERN"; then
    FOUND=$(content_matches "$HOOK_PATTERN")
    deny \
      "COMPONENT PURITY" \
      "Components in _components/ must be PURE presentational. No hooks, no state, no side effects.\n${FOUND}" \
      "Move ALL hooks and state logic to a Container in _containers/. The Container passes data down as props. Components ONLY receive props and render JSX. The only allowed hook is useFormStatus."
  fi
fi

# =============================================================================
# RULE 2: ORM / Database Boundary
# ORM libraries (Prisma, Drizzle), database clients, query builders,
# and schema table definitions can ONLY be imported and used in repository
# files inside infrastructure/repositories/. Nowhere else. Ever.
#
# NOTE: Pattern strings are assembled from fragments at runtime so that
# this hook file itself does not contain the literal banned strings and
# therefore does not trip its own scan when being written.
# =============================================================================

if [ "$IS_REPOSITORY" = false ] && [ "$IS_DATABASE_TYPE_FILE" = false ] && [ "$IS_INDEX_BARREL" = false ] && [ "$IS_SCHEMA_FILE" = false ] && [ "$IS_SDK_FILE" = false ]; then
  # Prisma ORM
  PRISMA_PKG="@prisma/client"
  PRISMA_NEW="new Prisma"
  PRISMA_CLASS="PrismaClient"
  PRISMA_IMPORT="from '.*prisma'"
  PRISMA_IMPORT2='from ".*prisma"'
  PRISMA_CALL='prisma\.[a-zA-Z]+\.'
  PRISMA_PATTERN="${PRISMA_PKG}|${PRISMA_IMPORT}|${PRISMA_IMPORT2}|${PRISMA_CALL}|${PRISMA_NEW}Client|${PRISMA_CLASS}"

  # Drizzle ORM
  DRIZZLE_PKG="drizzle"
  DRIZZLE_DASH="${DRIZZLE_PKG}-orm"
  DRIZZLE_CALL="db\.(select|insert|update|delete|query)"
  # Database client handle
  DB_HANDLE_1="@/lib/db"
  DB_HANDLE_2="@/database"
  DB_HANDLE_3="@/config/database"
  # Schema table imports — catch paths ending in /schema or containing /schema/
  SCHEMA_IMPORT="from[[:space:]]+['\"].*/(schema|tables)['\"]|from[[:space:]]+['\"].*/schema/|from[[:space:]]+['\"]\\..*schema['\"]"

  # Use case files may import db handles for pre-wiring (composition).
  # The ORM, schema, and query-builder checks still catch actual misuse.
  if [ "$IS_USECASE" = true ]; then
    ORM_PATTERN="${PRISMA_PATTERN}|${DRIZZLE_DASH}|${DRIZZLE_CALL}|${SCHEMA_IMPORT}"
  else
    ORM_PATTERN="${PRISMA_PATTERN}|${DRIZZLE_DASH}|${DRIZZLE_CALL}|${DB_HANDLE_1}|${DB_HANDLE_2}|${DB_HANDLE_3}|${SCHEMA_IMPORT}"
  fi

  if content_has "$ORM_PATTERN"; then
    FOUND=$(content_matches "$ORM_PATTERN")
    deny \
      "ORM / DATABASE BOUNDARY" \
      "ORM libraries, database clients, query builders, and schema tables can ONLY be used inside Repository files (infrastructure/repositories/). Found direct database access in a non-repository file.\n${FOUND}" \
      "Create or use a Repository method in modules/<module>/infrastructure/repositories/. The data flow is: action → useCase → repository → database. No shortcuts. No direct ORM imports. No direct db access."
  fi
fi

# =============================================================================
# RULE 3: Server Actions → Direct Imports from Allowed Paths
# actions.ts files (and any file in app/) import directly:
#   - Use cases from @/modules/{module}/application/{useCase}
#   - Types from @/modules/{module}/domain/types
#   - Session utilities from @/modules/{module}/infrastructure/session
#   - Core types from @/packages/@core/*
# They must NEVER import from:
#   - Composition roots (infrastructure/nucleus)
#   - Repositories (infrastructure/repositories/*)
#   - Other internal infrastructure files
#
# Application layer imports ARE allowed — app/ files can import pre-wired
# use cases directly from application/ use case files.
# =============================================================================

IS_APP_FILE=false
if [[ "$FILE_PATH" == */app/* ]] || [[ "$FILE_PATH" == app/* ]]; then IS_APP_FILE=true; fi

if [ "$IS_ACTION" = true ] || [ "$IS_APP_FILE" = true ]; then
  # No ORM library or database client imports
  # (Assembled from fragments — see Rule 2 note)
  APP_ORM_FRAG1="drizzle"
  APP_ORM_PATTERN="${APP_ORM_FRAG1}-orm|@/lib/db|@/database|db\.(select|insert|update|delete|query)"
  if content_has "$APP_ORM_PATTERN"; then
    FOUND=$(content_matches "$APP_ORM_PATTERN")
    deny \
      "APP LAYER — NO DIRECT DATABASE ACCESS" \
      "Files in app/ must NOT import ORM libraries, database clients, or use query builders directly.\n${FOUND}" \
      "All database access goes through Use Cases. Import a pre-wired use case from '@/modules/{module}/application/{verb}{Entity}UseCase'. The use case calls a repository internally."
  fi

  # No schema table imports
  APP_SCHEMA_PATTERN="from[[:space:]]+['\"].*/(schema|tables)['\"]|from[[:space:]]+['\"]\\..*schema['\"]|from[[:space:]]+['\"].*/schema/"
  if content_has "$APP_SCHEMA_PATTERN"; then
    FOUND=$(content_matches "$APP_SCHEMA_PATTERN")
    deny \
      "APP LAYER — NO SCHEMA IMPORTS" \
      "Files in app/ must NOT import database schema or table definitions.\n${FOUND}" \
      "Schema tables are infrastructure-private. Use a pre-wired use case for data access. Types: import from '@/modules/{module}/domain/types'."
  fi

  # No infrastructure imports EXCEPT infrastructure/session (which is a public API surface)
  if content_has "from.*infrastructure"; then
    INFRA_FOUND=$(printf '%s' "$CONTENT" | grep -nE "from.*infrastructure" 2>/dev/null | grep -vE "infrastructure/session" | head -5 || true)
    if [ -n "$INFRA_FOUND" ]; then
      deny \
        "MODULE BOUNDARY — NO INFRASTRUCTURE IMPORTS" \
        "Files in app/ must NOT import from infrastructure/ directly (except infrastructure/session).\n${INFRA_FOUND}" \
        "Use cases: import from '@/modules/mymodule/use-cases'. Session: import from '@/modules/mymodule/infrastructure/session'. Everything else in infrastructure/ is private."
    fi
  fi

  # No domain layer imports EXCEPT domain/types (which is the public type surface)
  if content_has "from.*modules/.*/domain/"; then
    DOMAIN_FOUND=$(printf '%s' "$CONTENT" | grep -nE "from.*modules/.*/domain/" 2>/dev/null | grep -vE "domain/types" | head -5 || true)
    if [ -n "$DOMAIN_FOUND" ]; then
      deny \
        "MODULE BOUNDARY — NO DOMAIN IMPORTS" \
        "Files in app/ must NOT import from a module's domain/ layer directly (except domain/types).\n${DOMAIN_FOUND}" \
        "Types: import from '@/modules/mymodule/domain/types'. Business logic and other domain files are private to the module."
    fi
  fi

  # No repository imports
  if content_has "import.*[Rr]epository|from.*infrastructure/repositories|from.*infrastructure/repository"; then
    FOUND=$(content_matches "[Rr]epository|infrastructure/repositor")
    deny \
      "ACTION LAYER BOUNDARY" \
      "Server Actions must NOT import Repositories directly.\n${FOUND}" \
      "Actions can ONLY call UseCases via '@/modules/mymodule/use-cases'."
  fi

  # No direct HTTP/fetch/axios calls
  if content_has "(^|[^a-zA-Z])fetch\s*\(|from ['\"]axios['\"]|axios\.(get|post|put|delete|patch|request)"; then
    FOUND=$(content_matches "fetch\s*\(|axios")
    deny \
      "ACTION LAYER BOUNDARY" \
      "Server Actions must NOT make direct HTTP/API calls.\n${FOUND}" \
      "Actions can ONLY call UseCases. Move the external service call into a UseCase → Repository chain."
  fi
fi

# =============================================================================
# RULE 4: UseCase Layer Boundary
# UseCases contain business logic and orchestrate repositories.
# They must NOT:
#   - Import ORM libraries (drizzle-orm, @prisma/client)
#   - Import database clients (@/lib/db)
#   - Import schema/table definitions
#   - Use query builders (db.select, db.insert, etc.)
#   - Make direct HTTP/API calls (fetch, axios)
#
# UseCases receive repository INTERFACES via dependency injection.
# The pre-wired section at the bottom of use case files may import
# concrete repository factories — but NEVER ORM utilities or db clients.
# =============================================================================

if [ "$IS_USECASE" = true ]; then
  # No ORM library imports
  # (Assembled from fragments — see Rule 2 note)
  UC_ORM_FRAG1="drizzle"
  UC_ORM_PATTERN="${UC_ORM_FRAG1}-orm|@pris""ma/client|Pris""maClient"
  if content_has "$UC_ORM_PATTERN"; then
    FOUND=$(content_matches "$UC_ORM_PATTERN")
    deny \
      "USE CASE LAYER — NO ORM IMPORTS" \
      "Use cases must NOT import ORM libraries. ORM access belongs exclusively in repositories.\n${FOUND}" \
      "Remove the ORM import. If this use case needs data, call a Repository method. The repository handles all ORM/database interaction."
  fi

  # Database client imports (@/lib/db) are ALLOWED in use case files for
  # pre-wiring (passing db to repository factories). The query-builder check
  # below catches any direct misuse. ORM + schema checks prevent query writing.

  # No schema/table imports
  UC_SCHEMA_PATTERN="from[[:space:]]+['\"].*/(schema|tables)['\"]|from[[:space:]]+['\"].*/schema/"
  if content_has "$UC_SCHEMA_PATTERN"; then
    FOUND=$(content_matches "$UC_SCHEMA_PATTERN")
    deny \
      "USE CASE LAYER — NO SCHEMA IMPORTS" \
      "Use cases must NOT import database schema or table definitions.\n${FOUND}" \
      "Schema tables are infrastructure-private. Define the data shape you need as a type in domain/types, and let the repository map between schema and domain types."
  fi

  # No query builder calls
  UC_QUERY_PATTERN="db\.(select|insert|update|delete|query)\s*\("
  if content_has "$UC_QUERY_PATTERN"; then
    FOUND=$(content_matches "$UC_QUERY_PATTERN")
    deny \
      "USE CASE LAYER — NO DIRECT QUERIES" \
      "Use cases must NOT execute database queries directly.\n${FOUND}" \
      "Move this query into a Repository method. The use case calls repo.findX() — never db.select()."
  fi

  # No direct HTTP/fetch/axios calls (existing check, preserved)
  if content_has "(^|[^a-zA-Z])fetch\s*\(|from ['\"]axios['\"]|axios\.(get|post|put|delete|patch|request)"; then
    FOUND=$(content_matches "fetch\s*\(|axios")
    deny \
      "USE CASE LAYER BOUNDARY" \
      "UseCases must NOT make direct HTTP/API calls.\n${FOUND}" \
      "Use a Repository for ALL external service access. Create a method in the appropriate repository in infrastructure/repositories/."
  fi
fi

# =============================================================================
# RULE 5: Frontend → Server Actions ONLY
# Components and containers must NOT import from backend layers.
# No prisma, no repositories, no useCases, no direct API calls.
# They can ONLY call Server Actions defined in actions.ts.
# =============================================================================

if [ "$IS_FRONTEND" = true ]; then
  # No useCase imports
  if content_has "import.*[Uu]se[Cc]ase|from.*application/|from.*use-case"; then
    FOUND=$(content_matches "[Uu]se[Cc]ase|application/|use-case")
    deny \
      "FRONTEND LAYER BOUNDARY" \
      "Frontend code must NOT import UseCases directly.\n${FOUND}" \
      "Frontend can ONLY call Server Actions (from actions.ts). The Server Action calls the UseCase internally."
  fi

  # No repository imports
  if content_has "import.*[Rr]epository|from.*infrastructure"; then
    FOUND=$(content_matches "[Rr]epository|infrastructure")
    deny \
      "FRONTEND LAYER BOUNDARY" \
      "Frontend code must NOT import from the infrastructure layer.\n${FOUND}" \
      "Frontend can ONLY call Server Actions. The data flow is: component → action → useCase → repository."
  fi

  # No direct fetch/axios
  if content_has "(^|[^a-zA-Z])fetch\s*\(|from ['\"]axios['\"]|axios\.(get|post|put|delete|patch|request)"; then
    FOUND=$(content_matches "fetch\s*\(|axios")
    deny \
      "FRONTEND LAYER BOUNDARY" \
      "Frontend code must NOT make direct HTTP/API calls.\n${FOUND}" \
      "Use a Server Action instead. Define the action in actions.ts and call it from the component/container."
  fi
fi

# =============================================================================
# RULE 6: Service Class Detection
# This project uses higher-order factory functions, never service classes.
# Error classes (extending Error) are the ONLY allowed class pattern.
#
# Blocked:  export class UserService { ... }
# Blocked:  export default class AuthController { ... }
# Allowed:  export class AccessError extends Error { ... }
# =============================================================================

SERVICE_CLASS_PATTERN="export[[:space:]]+(default[[:space:]]+)?class[[:space:]]+[A-Za-z]+(Service|Controller|Manager|Handler|Provider)[[:space:]]"

if content_has "$SERVICE_CLASS_PATTERN"; then
  # Filter out lines that are error subclasses — those are allowed
  FOUND=$(printf '%s' "$CONTENT" | grep -nE "$SERVICE_CLASS_PATTERN" 2>/dev/null | grep -vE "extends[[:space:]]+Error" | head -5 || true)

  if [ -n "$FOUND" ]; then
    deny \
      "SERVICE CLASS FORBIDDEN" \
      "Service classes are not allowed in this project. Found:\n${FOUND}" \
      "Use the higher-order function pattern: export const makeXUseCase = (deps) => { return async (input) => { ... }; };"
  fi
fi

# =============================================================================
# RULE 7: One Use Case Per File
# Files in */application/*UseCase* (or *use-case*) paths must export exactly
# ONE make*UseCase function. Multiple use cases in a single file are the
# monolithic service anti-pattern.
# =============================================================================

if [[ "$FILE_PATH" == */application/*UseCase* ]] || [[ "$FILE_PATH" == */application/*use-case* ]]; then
  USECASE_COUNT=$(printf '%s' "$CONTENT" | grep -cE "export[[:space:]]+const[[:space:]]+make[A-Z][a-zA-Z]*UseCase" 2>/dev/null || true)

  if [ "$USECASE_COUNT" -gt 1 ]; then
    FOUND=$(content_matches "export[[:space:]]+const[[:space:]]+make[A-Z][a-zA-Z]*UseCase")
    deny \
      "ONE USE CASE PER FILE" \
      "This file defines ${USECASE_COUNT} use cases. Only 1 is allowed per file.\n${FOUND}" \
      "Each use case gets its own file. Split into separate files like createXUseCase.ts and updateXUseCase.ts"
  fi
fi

# =============================================================================
# RULE 7b: Capability Sidecar Enforcement
# Every use case file MUST have a co-located .capability.ts sidecar file.
# When writing a *UseCase.ts file, verify the sidecar exists — or that the
# current write IS the sidecar. This prevents use cases from being shipped
# without their capability annotations.
#
# The prover generator (packages/prover/generate.ts) will error out if any
# use case is missing its sidecar, but this guard catches it at write time
# so the agent is forced to create the sidecar before moving on.
# =============================================================================

if [[ "$FILE_PATH" == */application/*UseCase.ts ]]; then
  # Derive the expected sidecar path
  SIDECAR_PATH="${FILE_PATH%.ts}.capability.ts"

  if [ ! -f "$SIDECAR_PATH" ]; then
    deny \
      "CAPABILITY SIDECAR MISSING" \
      "Use case file is being written but no .capability.ts sidecar exists at: ${SIDECAR_PATH}" \
      "Every use case MUST have a co-located .capability.ts sidecar file. Create ${SIDECAR_PATH} with a defineCapability() export BEFORE or alongside the use case file. See packages/@core/identity/application/ for examples."
  fi
fi

# =============================================================================
# RULE 8: Domain Layer Purity
# Files in */domain/* (excluding *Repository.ts) must not import from
# infrastructure/ or application/ layers. The domain depends on nothing
# outside itself and shared utilities.
# =============================================================================

if [ "$IS_DOMAIN" = true ]; then
  DOMAIN_IMPURE_PATTERN="from[[:space:]]+['\"].*infrastructure/|from[[:space:]]+['\"].*application/"

  if content_has "$DOMAIN_IMPURE_PATTERN"; then
    FOUND=$(content_matches "$DOMAIN_IMPURE_PATTERN")
    deny \
      "DOMAIN LAYER PURITY" \
      "Domain files cannot import from infrastructure/ or application/ layers.\n${FOUND}" \
      "Domain layer is pure — it depends on nothing outside itself and shared utilities. Move infrastructure concerns to the infrastructure layer."
  fi
fi

# =============================================================================
# RULE 9: Cross-Module Import Guard (Axiom of Isolation)
# Core modules inside packages/@core/ are blind to each other.
# A module may only import from itself or from packages/shared/.
# Cross-module communication is handled by the Application Layer using
# Soft Links (plain text UUIDs) — never by direct imports.
#
# Blocked:  packages/@core/auth/ importing from packages/@core/iam/
# Allowed:  packages/@core/auth/ importing from packages/shared/
#
# Implementation note: BASH_REMATCH is set by the [[ =~ ]] operator in the
# current shell process. We use a temp file for the while-read loop so that
# [[ =~ ]] runs in the same shell (not a subshell), preserving BASH_REMATCH.
# =============================================================================

if [[ "$FILE_PATH" =~ packages/@core/([^/]+)/ ]]; then
  CURRENT_MODULE="${BASH_REMATCH[1]}"

  # Write matching import lines to a temp file so the while-read loop runs
  # in the current shell, keeping BASH_REMATCH accessible.
  _TMPFILE=$(mktemp)
  printf '%s' "$CONTENT" | grep -E "from[[:space:]]+['\"].*@core/[^'\"]+['\"]" > "$_TMPFILE" 2>/dev/null || true

  while IFS= read -r import_line; do
    IMPORTED_MODULE=""

    if [[ "$import_line" =~ packages/@core/([^/]+) ]]; then
      IMPORTED_MODULE="${BASH_REMATCH[1]}"
    elif [[ "$import_line" =~ @core/([^/\"\']+) ]]; then
      IMPORTED_MODULE="${BASH_REMATCH[1]}"
    fi

    # Skip lines where we could not identify the imported module
    [ -z "$IMPORTED_MODULE" ] && continue

    # Allow: same module, or the shared package
    if [ "$IMPORTED_MODULE" = "$CURRENT_MODULE" ] || [ "$IMPORTED_MODULE" = "shared" ]; then
      continue
    fi

    rm -f "$_TMPFILE"
    deny \
      "AXIOM OF ISOLATION — CROSS-MODULE IMPORT FORBIDDEN" \
      "Module '@core/${CURRENT_MODULE}' must not import from '@core/${IMPORTED_MODULE}'.\nViolating line: ${import_line}" \
      "Axiom of Isolation: Core modules are blind to each other. Use Soft Links (plain text UUIDs) for cross-module references. The Application Layer orchestrates cross-module interactions."

  done < "$_TMPFILE"

  rm -f "$_TMPFILE"
fi

# =============================================================================
# RULE 10: Zombie Shield Enforcement  (WARN — does NOT block writes)
# Repository files that contain SELECT/read queries must include a
# soft-delete filter (isNull / deletedAt / deleted_at). This is a heuristic:
# if a read query pattern is present but no soft-delete guard is found
# anywhere in the content being written, emit a warning and allow the write.
# =============================================================================

if [ "$IS_REPOSITORY" = true ]; then
  READ_QUERY_PATTERN="\.select\(|\.findFirst\(|\.findMany\(|findById|findBy[A-Z]"

  if content_has "$READ_QUERY_PATTERN"; then
    SOFTDELETE_PATTERN="isNull|deletedAt|deleted_at"

    if ! content_has "$SOFTDELETE_PATTERN"; then
      FOUND=$(content_matches "$READ_QUERY_PATTERN")
      warn \
        "ZOMBIE SHIELD — SOFT-DELETE FILTER MISSING" \
        "This repository file contains read queries but no soft-delete filter (isNull / deletedAt / deleted_at) was detected.\nRead query lines:\n${FOUND}" \
        "Add a soft-delete guard to all SELECT/find queries. Example (Drizzle): where(and(eq(table.id, id), isNull(table.deletedAt))). This prevents deleted records from appearing in results."
    fi
  fi
fi

# =============================================================================
# RULE 11: Page Component Boundary
# Files matching */page.tsx must be Server Components that only orchestrate
# data and delegate rendering to a single child component. They must NOT:
#   a) carry a 'use client' directive (pages are always server components)
#   b) call any React hook (hooks belong in _containers/)
#   c) contain raw HTML JSX tags (markup belongs in _components/ or _containers/)
# =============================================================================

if [ "$IS_PAGE" = true ]; then

  # 11a: No 'use client' directive in pages
  if content_has "^['\"]use client['\"]"; then
    FOUND=$(content_matches "^['\"]use client['\"]")
    deny \
      "PAGE COMPONENT BOUNDARY — NO USE CLIENT" \
      "Page files must be Server Components. The 'use client' directive is forbidden in page.tsx.\n${FOUND}" \
      "Move all client-side logic (state, hooks, event handlers) to a Container in _containers/. The page fetches data server-side and passes it as props to the Container or Component."
  fi

  # 11b: No React hooks in pages
  PAGE_HOOK_PATTERN="(useState|useEffect|useReducer|useMemo|useCallback|useRef|useContext|useQuery|useMutation|useTransition|useOptimistic|useRouter|usePathname|useSearchParams|useLayoutEffect|useFormStatus)"

  if content_has "$PAGE_HOOK_PATTERN"; then
    FOUND=$(content_matches "$PAGE_HOOK_PATTERN")
    deny \
      "PAGE COMPONENT BOUNDARY — NO HOOKS IN PAGES" \
      "Page files must not use React hooks. Found hooks in page.tsx.\n${FOUND}" \
      "Move all hooks and state management to a Container in _containers/. The page.tsx is a Server Component — it fetches data and delegates rendering."
  fi

  # 11c: No raw HTML JSX tags in pages
  RAW_HTML_PATTERN="<(div|form|input|button|section|ul|ol|li|span|p|h[1-6]|table|thead|tbody|tr|td|th|label|select|option|textarea|dl|dt|dd|nav|header|footer|main|article|aside)[[:space:]>/]"

  if content_has "$RAW_HTML_PATTERN"; then
    FOUND=$(content_matches "$RAW_HTML_PATTERN")
    deny \
      "PAGE COMPONENT BOUNDARY — NO RAW HTML JSX IN PAGES" \
      "Page files must not contain raw HTML JSX. Found HTML elements directly in page.tsx.\n${FOUND}" \
      "Extract all JSX into a Component in _components/ or a Container in _containers/. The page should return a single component: return <MyPageView data={data} />;"
  fi

fi

# =============================================================================
# RULE 12: 'use client' Containment
# The 'use client' directive is ONLY allowed in:
#   - Files inside _containers/ directories
#   - error.tsx files (Next.js requires error boundaries to be client components)
# Everywhere else, server components are the default.
# =============================================================================

if [ "$IS_CONTAINER" = false ] && [ "$IS_ERROR_BOUNDARY" = false ]; then
  if content_has "^['\"]use client['\"]"; then
    FOUND=$(content_matches "^['\"]use client['\"]")
    deny \
      "USE CLIENT CONTAINMENT" \
      "The 'use client' directive is only allowed in _containers/ files (and error.tsx boundaries). Found 'use client' outside an allowed location.\n${FOUND}" \
      "Move all client-side logic (state, hooks, event handlers, browser APIs) into a Container file inside _containers/. Server Components are the default — only opt into client when you genuinely need interactivity."
  fi
fi

# =============================================================================
# RULE 13: Server-First Data Fetching (DENY)
# Containers that use useEffect with an empty dependency array are doing
# mount-only data fetching. In the App Router, data fetching belongs
# in Server Components — never in client-side effects. There is no valid
# reason to fetch data via useEffect or the use() hook.
# =============================================================================

if [ "$IS_CONTAINER" = true ]; then
  MOUNT_EFFECT_PATTERN="useEffect\([^)]*,[[:space:]]*\[\]"

  if content_has "$MOUNT_EFFECT_PATTERN"; then
    FOUND=$(content_matches "$MOUNT_EFFECT_PATTERN")
    deny \
      "SERVER-FIRST DATA FETCHING" \
      "Found useEffect with empty dependency array — this is mount-only data fetching that MUST happen on the server.\n${FOUND}" \
      "Move data fetching to the Server Component (page.tsx or a server container) and pass the data as props. There is no valid reason to fetch data via useEffect in this project."
  fi
fi

# =============================================================================
# RULE 14: Client Container Purity
# CLIENT containers (_containers/ files with 'use client') are slim state
# proxies. They manage client state, hooks, and event handlers, then delegate
# ALL rendering to components in _components/. Client containers must NOT
# contain raw HTML JSX tags — markup belongs in _components/.
#
# Server containers (no 'use client') MAY contain light composition markup.
# =============================================================================

if [ "$IS_CONTAINER" = true ]; then
  # Only enforce for client containers — check if content has 'use client'
  if content_has "^['\"]use client['\"]"; then
    CONTAINER_HTML_PATTERN="<(div|form|input|button|section|ul|ol|li|span|p|h[1-6]|table|thead|tbody|tr|td|th|label|select|option|textarea|dl|dt|dd|nav|header|footer|main|article|aside)[[:space:]>/]"

    if content_has "$CONTAINER_HTML_PATTERN"; then
      FOUND=$(content_matches "$CONTAINER_HTML_PATTERN")
      deny \
        "CLIENT CONTAINER PURITY — NO RAW HTML JSX" \
        "Client containers must be slim state proxies that delegate rendering to components. Found raw HTML JSX directly in a client container file.\n${FOUND}" \
        "Extract all JSX markup into a presentational Component in _components/. The client container manages state and event handlers, then passes data as props to the component. A client container's return should be a single component call: return <MyView data={data} onSubmit={handleSubmit} />;"
    fi
  fi
fi

# ============================================================================
# Next.js Tier-1 Write-Time Enforcement
# Added 2026-06-03. Enforces the 80/20 best practices that the auditor used to
# catch only post-hoc. See .claude/rules/nextjs-essentials.md for the rules.
#
# Suppression mechanism: any file may include a comment of the form
#   // @nucleus-skip-tier1: <check-name>
# to skip a specific Tier-1 check. Valid check names:
#   promise-all     — Check 1 (multiple awaits without Promise.all)
#   cache-decl      — Check 2 (missing cache strategy declaration)
#   image-dims      — Check 3 (next/image without width/height/fill)
#   image-priority  — Check 4 (first image without priority)
#   action-revalidate — Check 5 (mutation action without revalidatePath/Tag)
# Multiple skips on one line: // @nucleus-skip-tier1: promise-all, cache-decl
# A bare // @nucleus-skip-tier1: all skips every Tier-1 check.
# ============================================================================

# Returns 0 (true) if the file content opts out of the named check.
tier1_skipped() {
  local check_name="$1"
  # Look for the suppression marker — case-sensitive, comment-prefixed.
  if printf '%s' "$CONTENT" | grep -qE "@nucleus-skip-tier1:[[:space:]]*(all|[a-z0-9_-]*[[:space:]]*,[[:space:]]*)*${check_name}([[:space:]]*,|[[:space:]]*$|[[:space:]])" 2>/dev/null; then
    return 0
  fi
  if printf '%s' "$CONTENT" | grep -qE "@nucleus-skip-tier1:[[:space:]]*all([[:space:]]|$)" 2>/dev/null; then
    return 0
  fi
  return 1
}

# Path-shape detectors used by multiple Tier-1 checks.
IS_LAYOUT=false
if [[ "$FILE_PATH" == */layout.tsx ]]; then IS_LAYOUT=true; fi

IS_TSX_IN_APP=false
if [[ "$FILE_PATH" == */app/*.tsx ]] || [[ "$FILE_PATH" == app/*.tsx ]] || \
   [[ "$FILE_PATH" == */app/*/*.tsx ]] || [[ "$FILE_PATH" == */components/*.tsx ]] || \
   [[ "$FILE_PATH" == components/*.tsx ]]; then IS_TSX_IN_APP=true; fi
# Cover deeper paths under app/ and components/
case "$FILE_PATH" in
  */app/*.tsx|*/components/*.tsx) IS_TSX_IN_APP=true ;;
esac
if [[ "$FILE_PATH" == */app/* && "$FILE_PATH" == *.tsx ]]; then IS_TSX_IN_APP=true; fi
if [[ "$FILE_PATH" == */components/* && "$FILE_PATH" == *.tsx ]]; then IS_TSX_IN_APP=true; fi

# ----------------------------------------------------------------------------
# Check 1 — Multiple top-level `await` in page.tsx/layout.tsx without Promise.all
# ----------------------------------------------------------------------------

check_nextjs_promise_all() {
  if [ "$IS_PAGE" = false ] && [ "$IS_LAYOUT" = false ]; then return 0; fi
  if tier1_skipped "promise-all"; then return 0; fi

  # Count lines of the form: <indent> const|let|var <ident> = await <expr>
  # (indent required → excludes module-level top-of-file declarations that
  # are not inside the page function body)
  local await_count
  await_count=$(printf '%s' "$CONTENT" | grep -cE "^[[:space:]]+(const|let|var)[[:space:]]+[^=]+=[[:space:]]*await[[:space:]]" 2>/dev/null || echo 0)
  # Strip any trailing newline noise from grep -c
  await_count=$(printf '%s' "$await_count" | tr -d '[:space:]')
  [ -z "$await_count" ] && await_count=0

  if [ "$await_count" -ge 2 ]; then
    local promise_all_count
    promise_all_count=$(printf '%s' "$CONTENT" | grep -cE "Promise\.all\(" 2>/dev/null || echo 0)
    promise_all_count=$(printf '%s' "$promise_all_count" | tr -d '[:space:]')
    [ -z "$promise_all_count" ] && promise_all_count=0

    if [ "$promise_all_count" -eq 0 ]; then
      local found
      found=$(printf '%s' "$CONTENT" | grep -nE "^[[:space:]]+(const|let|var)[[:space:]]+[^=]+=[[:space:]]*await[[:space:]]" 2>/dev/null | head -5 || true)
      deny \
        "TIER-1 — PARALLEL DATA FETCHING" \
        "Multiple independent \`await\` calls in ${FILE_PATH} without \`Promise.all\`. Sequential awaits are 2-3× slower wall-clock than parallel. See \`.claude/rules/nexus-rules.md\` §4 and \`.claude/rules/nextjs-essentials.md\` §2 item 5.\n${found}" \
        "Wrap independent awaits in Promise.all: const [a, b] = await Promise.all([getA(), getB()]). If awaits are sequentially dependent, add a suppression comment near the awaits: // @nucleus-skip-tier1: promise-all"
    fi
  fi
}

# ----------------------------------------------------------------------------
# Check 2 — page.tsx missing explicit cache strategy declaration
# ----------------------------------------------------------------------------

check_nextjs_cache_decl() {
  if [ "$IS_PAGE" = false ]; then return 0; fi
  if tier1_skipped "cache-decl"; then return 0; fi

  if content_has "export[[:space:]]+const[[:space:]]+dynamic[[:space:]]*="; then return 0; fi
  if content_has "export[[:space:]]+const[[:space:]]+revalidate[[:space:]]*="; then return 0; fi
  if content_has "['\"]use cache['\"]"; then return 0; fi

  deny \
    "TIER-1 — EXPLICIT CACHE STRATEGY" \
    "${FILE_PATH} has no explicit cache strategy. Every route segment must declare \`export const dynamic = '...'\` OR \`export const revalidate = N\` OR include \`'use cache'\`. Implicit caching causes data leaks across users (authenticated) or DB thrashing (public). See \`.claude/rules/nexus-rules.md\` §3.1 and \`.claude/rules/nextjs-essentials.md\` §2 item 4." \
    "Add one of: \`export const dynamic = 'force-dynamic'\` (per-request), \`export const dynamic = 'force-static'\` (static), \`export const revalidate = 60\` (ISR seconds), or place \`'use cache'\` directive in the route. If this is intentional, add: // @nucleus-skip-tier1: cache-decl"
}

# ----------------------------------------------------------------------------
# Check 3 — `next/image` missing width/height (or fill)
# ----------------------------------------------------------------------------

check_nextjs_image_dims() {
  # Only enforce on .tsx files in app/ or components/
  if [[ "$FILE_PATH" != *.tsx ]]; then return 0; fi
  case "$FILE_PATH" in
    */app/*|app/*|*/components/*|components/*) ;;
    *) return 0 ;;
  esac
  if tier1_skipped "image-dims"; then return 0; fi

  # Verify next/image is imported. We accept both `import Image from 'next/image'`
  # and `import { ... } from 'next/image'`.
  if ! content_has "from[[:space:]]+['\"]next/image['\"]"; then
    return 0
  fi

  # Strategy: extract each <Image ...> attribute block (single-line or multi-line).
  # Replace newlines with spaces so grep -oE can match across lines while
  # preserving `[[:space:]]` semantics in the regex.
  local flattened
  flattened=$(printf '%s' "$CONTENT" | tr '\n' ' ')

  # Match <Image followed by attributes up to first > or />.
  # The regex is non-greedy by using [^>]* (no nested tags expected inside an Image element).
  local image_tags
  image_tags=$(printf '%s' "$flattened" | grep -oE "<Image[[:space:]]+[^>]*/?>" 2>/dev/null || true)

  if [ -z "$image_tags" ]; then return 0; fi

  local bad_tag=""
  # Process each tag found
  while IFS= read -r tag; do
    [ -z "$tag" ] && continue
    # Check for width= AND height=  OR  fill (as attribute, either `fill` bare or `fill={...}` or `fill=`)
    local has_width=false
    local has_height=false
    local has_fill=false
    if printf '%s' "$tag" | grep -qE "[[:space:]]width[[:space:]]*="; then has_width=true; fi
    if printf '%s' "$tag" | grep -qE "[[:space:]]height[[:space:]]*="; then has_height=true; fi
    if printf '%s' "$tag" | grep -qE "[[:space:]]fill([[:space:]]|=|/>|>)"; then has_fill=true; fi

    if [ "$has_fill" = true ]; then continue; fi
    if [ "$has_width" = true ] && [ "$has_height" = true ]; then continue; fi

    bad_tag="$tag"
    break
  done <<< "$image_tags"

  if [ -n "$bad_tag" ]; then
    deny \
      "TIER-1 — IMAGE DIMENSIONS" \
      "\`<Image>\` in ${FILE_PATH} missing \`width\`+\`height\` or \`fill\`. Causes CLS (layout shift). See \`.claude/rules/frankie-rules.md\` §6 and \`.claude/rules/nextjs-essentials.md\` §4 item 14.\nViolating tag: ${bad_tag}" \
      "Add explicit \`width={N} height={N}\` props, or use \`fill\` inside a container with set dimensions. If the image is decorative/SVG and dimensions don't apply, add: // @nucleus-skip-tier1: image-dims"
  fi
}

# ----------------------------------------------------------------------------
# Check 4 — First <Image> in a page without `priority` (WARN, non-blocking)
# ----------------------------------------------------------------------------

check_nextjs_image_priority() {
  if [ "$IS_PAGE" = false ]; then return 0; fi
  if tier1_skipped "image-priority"; then return 0; fi

  if ! content_has "from[[:space:]]+['\"]next/image['\"]"; then return 0; fi

  local flattened
  flattened=$(printf '%s' "$CONTENT" | tr '\n' ' ')

  # Extract the FIRST <Image ...> tag only.
  local first_tag
  first_tag=$(printf '%s' "$flattened" | grep -oE "<Image[[:space:]]+[^>]*/?>" 2>/dev/null | head -1 || true)

  if [ -z "$first_tag" ]; then return 0; fi

  if printf '%s' "$first_tag" | grep -qE "[[:space:]]priority([[:space:]]|=|/>|>)"; then
    return 0
  fi

  warn \
    "TIER-1 ADVISORY — LCP IMAGE PRIORITY" \
    "First \`<Image>\` in ${FILE_PATH} lacks \`priority\`. If this is the LCP image (typical for hero/above-fold), \`priority\` should be set. See \`.claude/rules/frankie-rules.md\` §6 item priority.\nFirst image: ${first_tag}" \
    "If this image is above the fold (the LCP), add \`priority\` so Next preloads it. If it is below the fold, leave it off and suppress with: // @nucleus-skip-tier1: image-priority"
}

# ----------------------------------------------------------------------------
# Check 5 — actions.ts mutation patterns missing revalidatePath/revalidateTag
# ----------------------------------------------------------------------------

check_nextjs_action_revalidate() {
  if [ "$IS_ACTION" = false ]; then return 0; fi
  if tier1_skipped "action-revalidate"; then return 0; fi

  # Must declare 'use server' to be a server-action file
  if ! content_has "^['\"]use server['\"]"; then return 0; fi

  # Detect exported async mutation patterns:
  #   create*, update*, delete*, *Action  (case-sensitive verbs at the start of the identifier;
  #   *Action allows any suffix shape)
  local mutation_pattern="export[[:space:]]+(async[[:space:]]+)?function[[:space:]]+(create|update|delete)[A-Z]|export[[:space:]]+(const|async[[:space:]]+function)[[:space:]]+(create|update|delete)[A-Z]|export[[:space:]]+(async[[:space:]]+)?function[[:space:]]+[a-zA-Z]+Action[[:space:]]*\(|export[[:space:]]+(const|async[[:space:]]+function)[[:space:]]+[a-zA-Z]+Action[[:space:]]*[:=]"

  if ! content_has "$mutation_pattern"; then return 0; fi

  # Allow if revalidatePath / revalidateTag / redirect is called anywhere in the file.
  # redirect() implicitly revalidates the destination.
  if content_has "revalidatePath[[:space:]]*\("; then return 0; fi
  if content_has "revalidateTag[[:space:]]*\("; then return 0; fi
  if content_has "redirect[[:space:]]*\("; then return 0; fi

  local found
  found=$(printf '%s' "$CONTENT" | grep -nE "$mutation_pattern" 2>/dev/null | head -5 || true)

  deny \
    "TIER-1 — MUTATION REVALIDATION" \
    "Server action in ${FILE_PATH} appears to mutate (matches create*/update*/delete*/Action) but does not call \`revalidatePath\` or \`revalidateTag\`. Stale data after mutation is a bug. See \`.claude/rules/nexus-rules.md\` §3.2 and \`.claude/rules/nextjs-essentials.md\` §2 item 6.\n${found}" \
    "After the mutation succeeds, call revalidatePath('/path/affected') or revalidateTag('tag-affected'). Alternatively redirect() to a fresh route (it implicitly revalidates the destination). If the action genuinely does not touch cached data, suppress with: // @nucleus-skip-tier1: action-revalidate"
}

# Invoke the Tier-1 checks in order. Each returns 0 if it passes; the deny/warn
# helpers exit the script themselves, so flow only reaches the next check when
# its predecessor did not fire.
check_nextjs_promise_all
check_nextjs_cache_decl
check_nextjs_image_dims
check_nextjs_image_priority
check_nextjs_action_revalidate

# =============================================================================
# All checks passed
# =============================================================================

exit 0
