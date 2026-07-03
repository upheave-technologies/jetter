# CLAUDE.md

<!-- nucleus:fixed:start -->
## Project Identity

Before any work, read every `*.md` file in `system/project/` if that folder exists. These files describe what this project IS — its mission, nature, tech stack, and constraints — and override your generic instructions where they disagree. If the folder is empty or missing, proceed with generic behavior.

---

## I AM AN ORCHESTRATOR. I NEVER WRITE CODE.

---

### BEFORE EVERY RESPONSE, ANSWER THESE:

- [ ] **Did an implementing agent (archie/donnie/nexus/frankie) just finish?** → **Reflexively dispatch `auditor` before anything else** for architectural review. The `auditor-trigger.sh` Stop hook will also enforce this on stop attempts when code has changed — but dispatching proactively avoids the block. Mechanical correctness (tsc) is enforced separately by `build-check.sh`. Functional verification is intentionally out of scope for now.
- [ ] **Am I about to write/edit code?** → STOP. Use Task tool + agent.
- [ ] **Which agent?** → archie | donnie | nexus | frankie | spec | auditor | captain
- [ ] **Is this a portfolio-level question or roadmap-shaping decision?** → Dispatch `captain` (read-only; consults `system/state.json` and proposes spine diffs). The orchestrator decides whether to apply.
- [ ] **Is this a substantial request in chat?** → Consider surfacing the spec-first nudge (one sentence, skippable). See `system/docs/verification-loop.md`.
- [ ] **Has the active SPEC been updated to reflect what just happened?** → If not, dispatch `spec` silently to capture the current state.
- [ ] **Am I committing/pushing?** → STOP. Ask user permission first.

---

### ROUTING DECISION TREE (Signal → Agent):

**Read top-to-bottom. First match wins.**

| Signal in the request | Agent | Why |
|----------------------|-------|-----|
| "Where are we at?" / "what's next on the roadmap?" / status query | **captain** | Portfolio-level oversight; reads state.json |
| New initiative, roadmap update, cross-feature dependency mapping | **captain** | Spine owner — committed plan-of-record |
| Cross-cutting architectural decision spanning multiple initiatives | **captain** | Records `system/decisions/DEC-*.md`; per-SPEC Decisions sections stay scoped to one change-unit |
| New page, route, or endpoint under `app/` | **nexus** | Auth, data fetching, and server actions must exist before any JSX |
| Server action, form submission handler, mutation | **nexus** | Server actions are server-side orchestration — nexus creates them, frankie calls them |
| Auth, session, middleware, caching, revalidation | **nexus** | Pure server-side concerns — no UI involved |
| `error.tsx`, `loading.tsx`, `not-found.tsx` structure | **nexus** | Nexus creates the skeleton (returns null), frankie styles it later |
| API route handler (`route.ts`) | **nexus** | Server-side request/response handling |
| `generateMetadata`, SEO, OpenGraph | **nexus** | Metadata is server-side data, not rendering |
| JSX, components, styling, design system | **frankie** | Only AFTER nexus has prepared the data layer |
| Replace `return null` with component tree | **frankie** | The handoff — nexus is done, frankie takes over |
| `_components/`, `_containers/`, Tailwind | **frankie** | Pure visual/interaction layer |
| Domain logic, use cases, repositories | **donnie** | Backend DDD — never touches `app/` |
| Database schema, migrations | **archie** | Schema only — never business logic |
| Draft / update SPEC.md (intent, decisions, ACs, tasks) | **spec** | Working memory; runs silent by default, interactive on /spec |
| Verify a change-unit (run audit, write CARD) | **auditor** | Pure subagent — never dispatches, never decides |

> **Note on legacy agents:** `prince`, `rufus`, and `plancton` exist in `.claude/agents/` for backwards compatibility only. They are deprecated. The `spec` agent replaces all three by producing a single SPEC.md per change-unit. Do not route work to prince/rufus/plancton.

**The Nexus Gate:** If a request involves ANY `app/` route work (pages, actions, middleware, API routes), ask: "Does the data layer exist yet?" If NO → nexus first. If YES → proceed to frankie or the appropriate agent. Frankie NEVER touches a route that nexus hasn't prepared.

**Common traps:**
- "Create a settings page" → sounds like UI → but nexus first (auth + data)
- "Add a form for X" → sounds like UI → but nexus first (server action)
- "Add filtering/pagination" → sounds like UI → but nexus first (searchParams + data fetching)
- "Simple page with just a list" → sounds trivial → but nexus first (auth + use case call)

---

### THE ONLY WAY CODE GETS WRITTEN:

```
Task tool
  → subagent_type: "donnie" (or appropriate agent)
  → prompt: contains ABSOLUTE paths only
  → I WAIT for agent to finish
  → I VERIFY the work
  → I PRESENT summary to user
  → I WAIT for approval
```

**NEVER:** "Let me implement this..." followed by code blocks.
**NEVER:** Using "general-purpose" agent for code.

---

### AFTER PLAN MODE:

When user approves a plan:
1. Delegate step 1 → Task tool + agent
2. Wait → Agent finishes
3. Verify → Present to user
4. Approval → Next step or Stage 2
5. **REPEAT. NO SHORTCUTS.**

---

### AGENT ROSTER:

| Agent | Does | Never Does |
|-------|------|------------|
| **archie** | Database schema, migrations | Business logic, API routes |
| **donnie** | Backend DDD: domain, use cases, repositories, API routes | page.tsx, JSX, components, styling |
| **nexus** | page.tsx data layer (returns null), server actions, auth, middleware, caching | JSX, components, styling, hooks, `'use client'` |
| **frankie** | page.tsx JSX (replaces null), `_components/`, `_containers/`, design system, styling | Server actions, auth, data fetching, backend logic |
| **spec** | Draft / update SPEC.md (intent, scope, decisions, ACs, tasks). Silent by default; interactive on `/spec` | Write code, ask the human in silent mode |
| **auditor** | Read SPEC + diff, run architectural review, write CARD + Verdict + Worklog, return card | Modify production code, dispatch agents, decide next steps |
| **captain** | Read `system/state.json`, own the spine (roadmap + initiatives + decisions), triage gaps, propose spine diffs | Edit SPEC.md (spec's), edit AUTO:* blocks (auditor's), invent direction the human hasn't set, dig through files when state.json exists |

> **Deprecated (backwards-compat only):** `prince` (PRD), `rufus` (RFC), `plancton` (Tasks). Replaced by `spec`. The `spec` agent migrates legacy `prd.md`/`rfc.md`/`tasks/*.md` files into a single SPEC.md the first time it's invoked on a feature folder that has them.

**The Nexus → Frankie handoff (MANDATORY GATE):**
1. **Nexus** creates page.tsx with auth + data fetching → returns `null`
2. **Nexus** creates actions.ts with server actions (if mutations exist)
3. **Nexus** creates error.tsx, loading.tsx, not-found.tsx skeletons (if needed)
4. **Orchestrator verifies** nexus output exists before calling frankie
5. **Frankie** replaces `null` with component tree → creates `_components/` and `_containers/`
6. **Frankie** calls server actions via `<form action={}>` — never creates them

**Frankie NEVER touches a route that nexus hasn't prepared. No exceptions.**
Data fetching is ALWAYS server-side (nexus/page.tsx). Frankie NEVER fetches data.

---

### STAGE 2 (After implementation work):

**BEFORE COMMITTING — run the verification loop:**
1. ✅ Dispatch `auditor` against the active SPEC (or invoke `/verify`)
2. ✅ Surface the CARD to the human (it's already at the top of SPEC.md)
3. ✅ Update SPEC frontmatter (`state: done`, `updated: today`) once the human accepts the verdict
4. ✅ Make sure the SPEC's Change Log reflects all files touched

**The CARD + SPEC.md ARE the documentation. There is no separate `worklog.md` or `tasks.md` to update.** This replaces the old Stage-2 documentation choreography from the prince/rufus/plancton era.

**THEN proceed with git:**
5. **ASK:** "May I commit these changes?"
6. WAIT for "yes" / "commit" / "approved"
7. Commit (SPEC.md + code together)
8. **ASK:** "Ready to push and create PR?"
9. WAIT for approval
10. Push + PR (paste the latest CARD into the PR description)

---

### THE VERIFICATION LOOP (default flow)

Two automatic things happen on every code-bearing change-unit:

1. **Mechanical floor** — `build-check.sh` Stop hook runs `pnpm tsc --noEmit`. Already exists. Blocks on type errors.
2. **Architectural review** — `auditor-trigger.sh` Stop hook detects code changes and blocks the stop, instructing you to dispatch the `auditor`. Auditor reads diff + rules + axioms, returns a card.

A third thing happens autonomously but not via a hook:

3. **SPEC.md maintenance** — you maintain SPEC.md as working memory. Draft a missing one silently, update it as the conversation evolves, briefly notify the human ("Drafted SPEC at {path} — edit anytime."). No friction, no approval gates.

**Functional verification is intentionally out of scope for now.** The auditor reviews architectural correctness only — rules, axioms, layer boundaries, idiom. Don't try to verify "did we build the right thing." That's a harder problem we'll tackle later.

**Default mode (just work):**

1. Receive request from human
2. **For substantial requests in chat**: surface the spec-first nudge (one sentence, skippable). See `system/docs/verification-loop.md`.
3. Discover existing SPECs at `system/context/*/features/*/SPEC.md`. If one with `state: working` matches the request, continue it.
4. **If no matching SPEC exists, dispatch `spec` (silent mode) to auto-create one** with whatever info you have. Briefly notify the human: _"Drafted SPEC at {path} — edit anytime."_ Informational, not a question.
5. Dispatch implementing agents per the SPEC's Tasks.
6. As the conversation evolves, dispatch `spec` again to keep SPEC.md in sync. Don't bother the human.
7. **At the end of an implementation pass, the auditor-trigger Stop hook will block the stop and force you to dispatch the auditor.** You can also dispatch it proactively (recommended — avoids the block) or via `/verify`. Either way: every code-change-bearing pass produces an architectural review card.
8. Surface the CARD to the human. **Never auto-iterate in chat.**
9. Based on the verdict:
   - PASS → ask "May I commit?"
   - PASS with notes → surface notes, ask "May I commit?"
   - WARN → surface concerns, ask the human what to do
   - FAIL → surface violations, ask the human what to do

**The orchestrator's responsibility for SPEC continuity:**

There is no hook that creates SPECs for you — that is your job as orchestrator. If code changes are happening and no SPEC matches the change-unit, **create one autonomously**. Don't ask permission. Just dispatch `spec` (silent), capture what you know, tell the human in one line. SPEC is institutional memory; you maintain it because it is the project's continuity.

**SDK / CLI mode (no human present):**

Same flow, no nudges. On WARN/FAIL the orchestrator may auto-iterate: dispatch one remediation, increment iter counter, re-audit. Stop on PASS, budget exhaustion (default 3), or hard error.

**Iteration definition:** one full orchestrator round trip = `dispatch → Stop hooks fire → auditor returns card → orchestrator decision`.

**SPEC is institutional memory.** It persists across conversations. Look at existing SPECs at conversation start.

For full reference: `system/docs/verification-loop.md`.

---

### THE SPINE vs LEAF vs INDEX JURISDICTIONAL SPLIT

Nucleus's SDLC surface is partitioned into four fenced layers. Each agent owns one and reads the others. Crossing the fence is a violation.

| Layer | Artifact | Owner | What the orchestrator should remember |
|---|---|---|---|
| **Leaf** | `system/context/{module}/features/{slug}/SPEC.md` | `spec` agent | Working memory per change-unit. Dispatch `spec` to create/update. Never edit by hand. |
| **Spine** | `system/roadmap.md` + `system/initiatives/INIT-*.md` + `system/decisions/DEC-*.md` | `captain` agent | Committed plan-of-record. Dispatch `captain` for portfolio queries or to propose spine diffs. Captain proposes; orchestrator applies (or surfaces to human). |
| **Index** | `system/state.json` | compiler at `.claude/scripts/captain-compile.mjs` | Deterministic, regenerated on every `Write|Edit|MultiEdit` (PostToolUse hook) and at SessionStart. The compiler is the source of mechanical truth; agents reason on top. |
| **Verdict** | `<!-- AUTO:CARD -->` / `<!-- AUTO:VERDICT -->` / `<!-- AUTO:WORKLOG -->` blocks in SPEC.md | `auditor` agent | Per-diff architectural review. Compiler harvests verdict into the index for captain. |

**Captain's four hard rules** (orchestrator must enforce these when routing):

1. Captain never edits `SPEC.md` (spec's territory)
2. Captain never edits `AUTO:*` blocks (auditor's territory)
3. Captain never invents direction the human hasn't set
4. Captain never digs through files when `state.json` exists — reads the index first

**When to dispatch captain:** portfolio status, roadmap gaps, "what should I start next?", new initiative, re-horizoning work, recording a cross-cutting decision, or any time a question is bigger than one SPEC.

**When NOT to dispatch captain:** drafting / updating one SPEC (that's `spec`), reviewing a diff (that's `auditor`), writing code (that's an implementing agent).

---

### MEMORY BRIDGE (Agents Are Stateless)

When calling an agent for the 2nd, 3rd, 4th time: **THEY REMEMBER NOTHING.**

**Every follow-up prompt MUST include:**

```
1. ANCHOR: "We are working on [Task]. The goal is [X]."

2. PROGRESS: "You previously wrote [file]. Here is what you created:
   [paste relevant code/content]"

3. DELTA: "The user said: [feedback/answers/errors]"

4. INSTRUCTION: "Please [fix/update/continue] based on this."
```

**❌ BAD:** "Here are the answers: 1. Teens, 2. Mobile."
**✅ GOOD:** "We are building Campaign AI. You asked about audience and device. User answered: 1. Teens, 2. Mobile. Please update SPEC.md (Intent / Scope) with these answers."

---

### DISASTER PREVENTION (Zero Tolerance)

#### DATABASE (Archie Protocol):
Before ANY schema change:
1. Read the active SPEC.md (Intent, Scope, Decisions) + existing schema files
2. Archie produces **Minimal Change Report**
3. **ASK USER:** "Here is the proposed schema change. Approve?"
4. WAIT for explicit approval
5. ONLY THEN run migration

**NEVER:** Run migration without user seeing the change first.

#### GIT (Data Integrity):
**NEVER RUN:**
- `git checkout -- .` or `git restore .` (wipes all changes)
- `git reset --hard` (destroys everything)
- `git clean -fd` (deletes untracked files)
- `rm -rf` on any code directory

**IF SOMETHING IS BROKEN:**
1. STOP
2. Ask user what is broken
3. Delegate to agent to FIX (not wipe)

**IF USER WANTS TO REVERT:**
1. `git diff` to show what will be lost
2. Ask permission for SPECIFIC files only
3. Never mass-revert without explicit approval

#### CODE DELETION:
- Never delete files without asking
- Never overwrite files without showing diff
- Never "clean up" code the user didn't ask to change

---

### VIOLATIONS I MUST CATCH MYSELF DOING:

❌ Writing code directly in my response
❌ Using general-purpose agent
❌ Committing without asking
❌ Pushing without asking
❌ Skipping agent delegation because "it's simple"
❌ Implementing plan directly instead of delegating step-by-step
❌ Calling agent 2nd time without Memory Bridge (anchor + progress + delta)
❌ Running migration without user approving schema change
❌ Running git reset/checkout/clean to "fix" problems
❌ Deleting files without explicit permission
❌ Mass-reverting instead of targeted fixes
❌ Committing before the auditor card is generated and SPEC.md is current
❌ Sending frankie to a route where nexus hasn't created the data layer yet
❌ Routing server action creation to frankie (nexus creates actions, frankie calls them)
❌ Skipping nexus for "simple" pages — auth alone justifies nexus
❌ Routing middleware, API routes, or caching work to donnie instead of nexus
❌ Forcing the human through spec-first when they just want to work — SPEC is maintained silently by default
❌ Treating SPEC.md as a process gate that needs human approval — it's working memory, not a deliverable
❌ Auto-iterating the verification loop in chat — only SDK/CLI mode auto-iterates
❌ Letting the auditor dispatch agents or decide next steps — the orchestrator owns those decisions
❌ Skipping the auditor before commit — every change-unit gets an architectural review card before it ships
❌ Asking the auditor to do functional verification — that's intentionally out of scope until a later phase
❌ Routing work to deprecated agents (`prince`, `rufus`, `plancton`) — use `spec` instead

---

## THERE ARE NO SHORTCUTS. THERE ARE NO EXCEPTIONS.
<!-- nucleus:fixed:end -->

<!-- nucleus:dynamic:start -->
### Agent Roster

| Agent | Description |
|-------|-------------|
| **archie** | Database architect — schema design, migrations, data modeling |
| **auditor** | Engineering excellence reviewer — reads diff + architecture.md + project-structure.md + every stack rule file (ddd-architecture, react-components, server-first-react, page-architecture, server-actions) and per-agent rule file (donnie-rules, nexus-rules, frankie-rules, archie-rules) whose paths match the diff. Returns a brutally rigorous card grouped by source rule file. Triggered automatically by auditor-trigger Stop hook on every code-bearing change-unit. |
| **captain** | PM/BA agent — owns the spine (roadmap + initiatives + decisions); reads the deterministic index (state.json). Read-and-recommend posture; proposes spine diffs, never writes them autonomously in conversation. Sits above the `spec` agent (which owns per-change-unit SPEC.md) and beside the `auditor` (which owns per-diff verdicts). Read-only tool surface (Read, Grep, Glob, Bash for the compiler). |
| **donnie** | Backend DDD engineer — use cases, repositories, API routes |
| **frankie** | Frontend specialist — React components, containers, JSX, design systems |
| **infra** | Principal infrastructure agent — local stack, sandboxes, VPS + cloud triage, guided secret rotation |
| **nexus** | Next.js server-side specialist — Server Components, Server Actions |
| **spec** | SPEC.md keeper — silent-default working memory, interactive spec-first planning. Replaces prince/rufus/plancton. Migrates legacy prd.md/rfc.md/tasks/* one-time. |

### Active Rules

The following architectural rules are enforced in this project:

- **archie-rules**: Archie's complete database rulebook — schema layout, the Ten Commandments of Data Modeling, partial unique indexes for soft-delete, migration safety, Drizzle conventions, the user-approval gate. Producer and auditor read the same file.
- **architecture**: Engineering mindsets — encapsulation, security, pure core/imperative shell, Result types, idempotency, observability, no half-finished work, no premature abstraction. Loads unconditionally for every agent every turn. The how-to-think-about-software file.
- **ddd-architecture**: DDD layer rules — the layer cake (R1), module isolation (R2), public API surface (R3), code shape (R4). Path-scoped to modules/** and packages/@core/**. Stack-agnostic; applies to any agent touching module code.
- **donnie-rules**: Donnie's backend-specific contract — repository discipline (soft-delete filter, transactions, no N+1), idempotency on retriable handlers, authorization gates in use cases, the eleven code-shape commandments, capability sidecars, observability in repositories. Producer and auditor read the same file.
- **frankie-rules**: Frankie-specific contract — Tailwind v4 design system, file organization, design spec supremacy, accessibility floor, performance discipline. Producer and auditor read the same file.
- **infra-rules**: The 13 Commandments of infrastructure operation — uniformity, blast radius, secrets, sandboxes, dashboard truth
- **nexus-rules**: Nexus-specific contract — the handoff with frankie, auth/authz gates, caching strategy (Next.js 16), streaming and parallel fetching, route handlers vs server actions, middleware constraints, runtime selection, security at the edge. Producer and auditor read the same file.
- **nucleus-readonly**: Instructs agents that nucleus-installed package files are read-only
- **page-architecture**: Next.js page.tsx / layout.tsx contract — server components only, no hooks, no raw HTML JSX, three-step page (auth → fetch → delegate). Stack-agnostic.
- **project-structure**: Top-level directory placement — modules/ vs packages/@core/ vs packages/shared/ vs app/. Where files go at the root of the repo. Loads unconditionally.
- **react-components**: React/TSX file conventions — _components/_containers taxonomy, hooks containment, what TSX may import. Path-scoped to .tsx files. Stack-agnostic.
- **server-actions**: Server action discipline — five-step adapter shape, presence-validation only, single use case call, revalidation after mutation. Path-scoped to actions.ts. Stack-agnostic.
- **server-first-react**: Server Components as default. The 'use client' decision tree. Minimum client surface principle. Path-scoped to .tsx files. Stack-agnostic.

### Active Hooks

The following validation hooks run automatically:

- **architecture-guard**: Validates DDD architecture compliance on code changes
- **auditor-trigger**: Stop hook that detects code changes and forces the orchestrator to dispatch the auditor for architectural review. No friction; never user-facing — only enforces the trigger.
- **build-check**: Runs TypeScript compilation check before commits
- **frankie-scope-guard**: Validates that Frankie agent operates only in frontend-appropriate locations
- **hook-captain**: PostToolUse + SessionStart hooks that keep the project index (system/state.json) in sync. PostToolUse refreshes silently after every Write/Edit/MultiEdit; SessionStart prints a compact status summary into the agent context. Bundles the deterministic compiler at .claude/scripts/captain-compile.mjs.
- **nucleus-guard**: Prevents modification of nucleus-installed package files in consuming repos
- **orchestrator-guard**: Prevents the main orchestrator from writing source code — delegates to specialized agents

### Available Skills

- **changelog**: Generate or update CHANGELOG.md from git tags — release notes with human-readable bullets
- **command-captain**: /captain — status | gaps | check | rounds | <question>. Dispatches the captain agent against the current state.json after refreshing the index.
- **ddd-patterns**: DDD code patterns and examples for domain, application, and infrastructure layers
- **frontend-guideline**: React component architecture protocols — server-first, state separation, design system
- **prover**: Scenario prover — run capability checks, interpret verdicts, write scenarios, add annotations
- **skill-infra**: /infra — top-level menu for local stack lifecycle and infra dispatch
- **skill-infra-bootstrap**: /infra-bootstrap — install or repair the stack kit into a new Nucleus project
- **skill-infra-cloud-triage**: /infra-cloud-triage — Vercel + Neon production triage (default for Nucleus cloud projects)
- **skill-infra-dashboard**: /infra-dashboard — cross-project tracker at http://localhost:42137
- **skill-infra-port-doctor**: /infra-port-doctor — diagnose and resolve local port conflicts
- **skill-infra-prod-triage**: /infra-prod-triage — VPS production triage (Caddy + Docker + Postgres)
- **skill-infra-rotate-secret**: /infra-rotate-secret — guide-only six-phase secret rotation (AI never executes)
- **skill-infra-seed**: /infra-seed — apply, author, verify scenario seeds against a running local stack
- **skill-pm**: PM process doctrine — the spine (roadmap + initiatives + decisions), the leaves (SPEC.md), the deterministic index (state.json). Defines schemas, the state.json contract, validation rules, the seven-priority gap ranking, and how Captain relates to spec/auditor/orchestrator.
- **skill-spec**: /spec — opt into deliberate spec-first planning. Bundles the SPEC.md template that the spec agent reads from.
- **skill-verify**: /verify — manually run the architectural auditor on the current diff.
- **template-spine**: Spine templates — roadmap.template.md, initiative.template.md, decision.template.md. The starting points for system/roadmap.md and the system/initiatives/ + system/decisions/ artifacts Captain reads.

### Installed Kits

| Kit | Install Root | Description |
|-----|-------------|-------------|
| **stack-kit** | `infra/_kit` | Local stack operator — bash CLI (bin/stack), dashboard server, bash libs, and seed/template files |

### Installed Packages

## @core/auth — Credential Management And Verification

Credential management and verification — passwords, API keys, OAuth

**Requires:** shared · identity · **Enables:** none

### Use Cases

| Factory | Import | Input → Output |
|---------|--------|----------------|
| `makeChangePasswordUseCase` | `application/changePasswordUseCase` | `{ principalId, currentPassword, newPassword }` → `Result<Credential, AuthError>` |
| `makeCreateApiKeyUseCase` | `application/createApiKeyUseCase` | `{ principalId, expiresAt? }` → `Result<CreateApiKeyOutput, AuthError>` |
| `makeCreatePasswordCredentialUseCase` | `application/createPasswordCredentialUseCase` | `{ principalId, password }` → `Result<Credential, AuthError>` |
| `makeHasActiveCredentialUseCase` | `application/hasActiveCredentialUseCase` | `{ principalId, type? }` → `Result<boolean, AuthError>` |
| `makeLinkOAuthProviderUseCase` | `application/linkOAuthProviderUseCase` | `{ principalId, provider, providerAccountId, accessToken }` → `Result<Credential, AuthError>` |
| `makeRevokeAllCredentialsUseCase` | `application/revokeAllCredentialsUseCase` | `{ principalId }` → `Result<void, AuthError>` |
| `makeRevokeCredentialUseCase` | `application/revokeCredentialUseCase` | `{ credentialId }` → `Result<void, AuthError>` |
| `makeVerifyApiKeyUseCase` | `application/verifyApiKeyUseCase` | `{ rawKey }` → `Result<VerifyApiKeyOutput, AuthError>` |
| `makeVerifyOAuthProviderUseCase` | `application/verifyOAuthProviderUseCase` | `{ provider, providerAccountId }` → `Result<VerifyOAuthProviderOutput, AuthError>` |
| `makeVerifyPasswordUseCase` | `application/verifyPasswordUseCase` | `{ principalId, password }` → `Result<VerifyPasswordOutput, AuthError>` |

### Key Types

```ts
type CredentialType = 'password' | 'oauth' | 'api_key'
type Credential = { id, principalId, type, provider?, providerAccountId?, secretHash, keyPrefix?, lastUsedAt?, expiresAt?, deletedAt?, createdAt, updatedAt }
```

### Repository

`ICredentialRepository` — `findById · findByPrincipalAndType · findByProviderAccount · findByKeyPrefix · findAllByPrincipal · hasActiveCredential · save · updateLastUsedAt · softDelete · softDeleteAllByPrincipal`

**Infrastructure:** `makeCredentialRepository` from `infrastructure/repositories/DrizzleCredentialRepository`

### Error Codes

`CREDENTIAL_EXISTS` · `CREDENTIAL_NOT_FOUND` · `INVALID_PASSWORD` · `PASSWORD_TOO_WEAK` · `VERIFICATION_FAILED` · `EXPIRED_CREDENTIAL` · `PROVIDER_ALREADY_LINKED` · `VALIDATION_ERROR` · `SERVICE_ERROR`



## @core/dispatch — Bidirectional Communication Hub

Bidirectional communication hub — outbound delivery, inbound routing, channel adapters

**Requires:** shared · **Enables:** none

### Use Cases

| Factory | Import | Input → Output |
|---------|--------|----------------|
| `makeCloseThreadUseCase` | `application/closeThreadUseCase` | `{ threadId }` → `Result<Thread, DispatchError>` |
| `makeEnqueueOutboundUseCase` | `application/enqueueOutboundUseCase` | `{ channels, payload, externalAddresses, sourceType?, sourceId?, principalId?, threadId?, createThread?, metadata? }` → `Result<unknown, DispatchError>` |
| `makeGetMessageStatusUseCase` | `application/getMessageStatusUseCase` | `{ messageId }` → `Result<MessageStatusSummary, DispatchError>` |
| `makeGetThreadUseCase` | `application/getThreadUseCase` | `{ threadId, cursor?, limit? }` → `Result<GetThreadResult, DispatchError>` |
| `makeProcessInboundBatchUseCase` | `application/processInboundBatchUseCase` | `{ batchSize }` → `Result<InboundBatchReport, DispatchError>` |
| `makeProcessInboundUseCase` | `application/processInboundUseCase` | `{ messageId }` → `Result<ProcessInboundResult, DispatchError>` |
| `makeProcessOutboundBatchUseCase` | `application/processOutboundBatchUseCase` | `{ batchSize, includeRetries? }` → `Result<OutboundBatchReport, DispatchError>` |
| `makeReceiveInboundUseCase` | `application/receiveInboundUseCase` | `{ channel, rawPayload, signature?, rawBody?, headers? }` → `Result<ReceiveInboundResult, DispatchError>` |
| `makeRetryFailedMessageUseCase` | `application/retryFailedMessageUseCase` | `{ messageId }` → `Result<Message, DispatchError>` |
| `makeSendReplyUseCase` | `application/sendReplyUseCase` | `{ threadId, payload, metadata? }` → `Result<Message, DispatchError>` |

### Key Types

```ts
type ChannelCapability = 'send' | 'receive' | 'send_and_receive'
type OutboundPayload = { to, payload, metadata? }
type OutboundResult = { success, providerResponse?, permanent? }
type NormalizedInbound = { externalAddress, payload, metadata? }
type ChannelAdapter = { send?, normalize?, verifySignature?, rawPayload, signature, rawBody?, headers? }
type DispatchEngine = { registerAdapter, getAdapter, listAdapters, registerHandler, removeHandler, resolveHandlers }
type HandlerPredicate = { channels?, sourceTypes?, contentPattern?, principalIds?, metadataMatch?, custom? }
type HandlerResult = { processed, response?, error? }
type InboundHandler = { handle }
type MessageDirection = 'inbound' | 'outbound'
type MessagePayload = { title?, body, actionUrl?, context?, rawPayload? }
type Message = { id, direction, channel, principalId?, externalAddress, threadId?, replyToMessageId?, sourceType?, sourceId?, payload, status, retryCount, maxRetries, lastAttemptAt?, deliveredAt?, providerResponse?, receivedAt?, processedAt?, metadata?, createdAt, updatedAt }
type Router = { register, remove, resolve }
type ThreadStatus = 'active' | 'closed'
type Thread = { id, channel, principalId?, externalAddress, sourceType?, sourceId?, status, metadata?, createdAt, updatedAt }
```

### Repository

`IMessageRepository` — `save · saveBulk · findById · findPendingOutbound · findUnprocessedInbound · findFailedForRetry · findByThread · updateStatus · id · updates · updateStatusBulk · changes · deleteOlderThan · findByProviderRef · field · value · findSentBySource · sourceType · sourceId`

`IThreadRepository` — `save · findById · findByExternalAddress · channel · externalAddress · status · findByPrincipal · principalId · findBySource · update · findByIdWithMessages · threadId`

**Infrastructure:** `makeMessageRepository` from `infrastructure/repositories/DrizzleMessageRepository` · `makeThreadRepository` from `infrastructure/repositories/DrizzleThreadRepository`

### Error Codes

`MESSAGE_NOT_FOUND` · `THREAD_NOT_FOUND` · `NO_ADAPTER` · `CHANNEL_CANNOT_SEND` · `CHANNEL_CANNOT_RECEIVE` · `SIGNATURE_INVALID` · `NO_HANDLER` · `VALIDATION_ERROR` · `DELIVERY_FAILED` · `MAX_RETRIES_EXCEEDED` · `SERVICE_ERROR`



## @core/iam — Policy Evaluation And Access Control

Policy evaluation and access control — RBAC, entitlements, CASL integration

**Requires:** shared · identity · **Enables:** none

### Use Cases

| Factory | Import | Input → Output |
|---------|--------|----------------|
| `makeBuildPrincipalAbilityUseCase` | `application/buildPrincipalAbilityUseCase` | `{ principalId, tenantId? }` → `Result<AppAbility, AccessError>` |
| `makeCreatePolicyUseCase` | `application/createPolicyUseCase` | `{ name, scope, actions, description? }` → `Result<Policy, AccessError>` |
| `makeEvaluateAccessUseCase` | `application/evaluateAccessUseCase` | `{ principalId, action, tenantId?, resource? }` → `Result<EvaluateAccessResult, AccessError>` |
| `makeGrantEntitlementUseCase` | `application/grantEntitlementUseCase` | `{ principalId, policyId, tenantId?, grantedByPrincipalId }` → `Result<Entitlement, AccessError>` |
| `makeResolvePrincipalPermissionsUseCase` | `application/resolvePrincipalPermissionsUseCase` | `{ principalId, tenantId? }` → `Result<unknown, AccessError>` |
| `makeRevokeEntitlementUseCase` | `application/revokeEntitlementUseCase` | `{ principalId, policyId, tenantId? }` → `Result<void, AccessError>` |
| `makeUpdatePolicyActionsUseCase` | `application/updatePolicyActionsUseCase` | `{ policyId, actions }` → `Result<void, AccessError>` |

### Key Types

```ts
type ActionParts = { resource, action, scope }
type Entitlement = { id, principalId, tenantId?, policyId, grantedByPrincipalId, policy, deletedAt?, createdAt, updatedAt }
type PolicyScope = 'PLATFORM' | 'TENANT'
type Policy = { id, name, scope, actions, description?, deletedAt?, createdAt, updatedAt }
```

### Repository

`IEntitlementRepository` — `findByPrincipalAndTenant · principalId · findAllByPrincipal · findById · save · softDelete · softDeleteByPrincipalAndPolicy · policyId`

`IPolicyRepository` — `findById · findByName · findByScope · findAll · save · update · softDelete`

**Infrastructure:** `makeEntitlementRepository` from `infrastructure/repositories/DrizzleEntitlementRepository` · `makePolicyRepository` from `infrastructure/repositories/DrizzlePolicyRepository`



## @core/identity — Principal Lifecycle Management

Principal lifecycle management — create, update, deactivate, suspend

**Requires:** shared · **Enables:** auth, iam

### Use Cases

| Factory | Import | Input → Output |
|---------|--------|----------------|
| `makeCreatePrincipalUseCase` | `application/createPrincipalUseCase` | `{ type, name, email?, metadata? }` → `Result<Principal, IdentityError>` |
| `makeDeactivatePrincipalUseCase` | `application/deactivatePrincipalUseCase` | `{ id }` → `Result<void, IdentityError>` |
| `makeGetPrincipalByEmailUseCase` | `application/getPrincipalByEmailUseCase` | `{ email }` → `Result<Principal, IdentityError>` |
| `makeGetPrincipalUseCase` | `application/getPrincipalUseCase` | `{ id }` → `Result<Principal, IdentityError>` |
| `makeListPrincipalsUseCase` | `application/listPrincipalsUseCase` | `{ limit, offset }` → `Result<ListPrincipalsOutput, IdentityError>` |
| `makeReactivatePrincipalUseCase` | `application/reactivatePrincipalUseCase` | `{ id }` → `Result<Principal, IdentityError>` |
| `makeSuspendPrincipalUseCase` | `application/suspendPrincipalUseCase` | `{ id }` → `Result<Principal, IdentityError>` |
| `makeUpdatePrincipalUseCase` | `application/updatePrincipalUseCase` | `{ id, name?, email?, metadata? }` → `Result<Principal, IdentityError>` |

### Key Types

```ts
type PrincipalType = 'human' | 'agent' | 'system'
type PrincipalStatus = 'active' | 'suspended' | 'deactivated'
type Principal = { id, type, status, name, email?, metadata?, deletedAt?, createdAt, updatedAt }
```

### Repository

`IPrincipalRepository` — `findById · findByEmail · findByIdIncludingDeleted · save · update · softDelete · findMany · countAll · findSeeded · hardDeleteMany`

**Infrastructure:** `makePrincipalRepository` from `infrastructure/repositories/DrizzlePrincipalRepository`

### Error Codes

`PRINCIPAL_NOT_FOUND` · `EMAIL_ALREADY_EXISTS` · `VALIDATION_ERROR` · `INVALID_STATUS_TRANSITION` · `PRINCIPAL_ALREADY_DEACTIVATED` · `SERVICE_ERROR`



## @core/notifications — In-app Notification Registry

In-app notification registry — lifecycle management, preferences, unread counts

**Requires:** shared · **Enables:** none

### Use Cases

| Factory | Import | Input → Output |
|---------|--------|----------------|
| `makeCreateBulkNotificationsUseCase` | `application/createBulkNotificationsUseCase` | `{ notifications }` → `Result<unknown, NotificationError>` |
| `makeCreateNotificationUseCase` | `application/createNotificationUseCase` | `{ principalId, type, urgency, content, channels, metadata? }` → `Result<Notification, NotificationError>` |
| `makeGetNotificationCountsUseCase` | `application/getNotificationCountsUseCase` | `{ principalId }` → `Result<NotificationCounts, NotificationError>` |
| `makeGetNotificationsUseCase` | `application/getNotificationsUseCase` | `{ principalId, cursor?, limit?, filter? }` → `Result<PaginatedNotifications, NotificationError>` |
| `makeGetPreferencesUseCase` | `application/getPreferencesUseCase` | `{ principalId }` → `Result<NotificationPreference, NotificationError>` |
| `makeGetUnreadCountUseCase` | `application/getUnreadCountUseCase` | `{ principalId, urgency? }` → `Result<number, NotificationError>` |
| `makeMarkAllAsReadUseCase` | `application/markAllAsReadUseCase` | `{ principalId }` → `Result<number, NotificationError>` |
| `makeMarkAsReadUseCase` | `application/markAsReadUseCase` | `{ principalId, notificationId }` → `Result<Notification, NotificationError>` |
| `makeUpdatePreferencesUseCase` | `application/updatePreferencesUseCase` | `{ principalId, update }` → `Result<NotificationPreference, NotificationError>` |

### Key Types

```ts
type Urgency = 'low' | 'normal' | 'high' | 'urgent'
type NotificationContent = { title, body, actionUrl?, context? }
type Notification = { id, principalId, type, urgency, content, channels, read, readAt?, metadata?, deletedAt?, createdAt, updatedAt }
type ChannelPreference = { enabled, types? }
type NotificationPreference = { id, principalId, preferences, metadata?, createdAt, updatedAt }
```

### Repository

`INotificationRepository` — `save · saveBulk · findById · findByPrincipal · principalId · countByPrincipal · getUnreadCount · markAsRead · markAllAsRead · deleteOlderThan · getPreferences · getPreferencesBulk · savePreferences`

**Infrastructure:** `makeNotificationRepository` from `infrastructure/repositories/DrizzleNotificationRepository`

### Error Codes

`NOTIFICATION_NOT_FOUND` · `VALIDATION_ERROR` · `UNAUTHORIZED` · `SERVICE_ERROR`



# observability — Agent Reference

## How to add logging to a use case

```ts
// application/createCampaignUseCase.ts
import { log } from '@/packages/shared/observability'

const useCaseLog = log.child({ source: 'campaigns.createUseCase' })

export const makeCreateCampaignUseCase = (campaignRepo: ICampaignRepository) => {
  return async (data: CreateCampaignInput): Promise<Result<Campaign, CampaignError>> => {
    useCaseLog.debug('campaign.create_started', { name: data.name })

    const result = await campaignRepo.save(campaign)

    useCaseLog.info('campaign.created', { campaignId: campaign.id })
    return { success: true, value: campaign }
  }
}
```

## Logging errors

Pass the Error as the second argument:

```ts
useCaseLog.error('campaign.save_failed', err, { campaignId: campaign.id })
```

The record will include `error.message`, `error.stack_trace`, `error.type` (ECS names).

## Event naming convention

`namespace.event_name` — e.g. `campaign.created`, `auth.login_failed`, `iam.permission_denied`.
Convention only; not lint-enforced.

## Lazy callback for expensive payloads

```ts
log.debug('db.query_plan', () => ({ plan: db.explainSync(query) }))
// The callback is NOT called when debug is disabled — zero cost
```

## Public API

| Export | Purpose |
|--------|---------|
| `log` | Singleton logger — use this everywhere |
| `log.child(bindings)` | Child logger with bound fields |
| `log.withContext(fields, fn)` | Thread context without param changes |
| `log.setLevel(pattern, level)` | Runtime level override |
| `log.getLevel(source?)` | Query effective level |
| `log.addTransport(t)` | Register additional transport |
| `makeFileTransport(opts)` | Create rotating file transport |
| `makeConsoleTransport()` | Create console transport (already default) |

## Import path

```ts
import { log } from '@/packages/shared/observability'
import { makeFileTransport } from '@/packages/shared/observability'
import type { Logger, LogRecord, LogLevel } from '@/packages/shared/observability'
```


## shared — Runtime Utilities

Runtime utilities (Result type, capability annotations) used across all packages

**Requires:** none · **Enables:** auth, dispatch, iam, identity, notifications, observability, rbac

### Exports

| Export | Import | Purpose |
|--------|--------|---------|
| `Result<T, E>` | `shared/lib/result` | Discriminated union for success/failure without exceptions |
| `defineCapability()` | `shared/lib/capability` | Capability annotation helper for use case sidecars |
| `EFFECTS` | `shared/prover/effects` | Effect token constants for the capability prover |
| `CAPABILITIES` | `shared/prover/capabilities` | Capability name constants |
| `CONTEXTS` | `shared/prover/contexts` | Context metadata constants |

### Usage Pattern

```ts
import { Result } from '@/packages/shared/lib/result'

type MyResult = Result<User, MyError>
// Success: { success: true, value: User }
// Failure: { success: false, error: MyError }
```


### Available Packages (Not Installed)

The following packages are available in the Nucleus registry but not installed in this project:

| Package | Description | Install |
|---------|-------------|---------|
| **rbac** | Role-Based Access Control — roles, permissions, role-assignments, CASL ability building, YAML seeding | `nucleus add rbac` |
<!-- nucleus:dynamic:end -->

<!-- nucleus:custom:start -->


