<!--
SPEC.md — working memory for one change-unit.

Lives at: system/context/{module}/features/{feature-slug}/SPEC.md

This is a journal Claude maintains autonomously. It is not a process the human
runs. Claude drafts it silently as the first internal step of any non-trivial
change, updates it as the conversation evolves, and uses it as institutional
memory across conversations.

Humans are welcome to read, edit, or ignore it. Spec-first workflow is opt-in:
the human invokes /spec or accepts a one-line nudge when they want it. By
default, Claude just works and keeps the SPEC in sync in the background.

The auditor (architectural review) updates the AUTO sections at the top and
bottom on every audit. Acceptance Criteria here are documentation of intent —
the auditor does NOT run them as executable verifiers. Functional verification
will arrive in a later phase.
-->

---
id: <module>-<short-slug>                    # e.g. iam-add-policy-versioning
type: feature                                # see "type" reference below
state: working                               # working | paused | done | abandoned
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

<!--
type values:
  feature       — net-new capability or surface
  modification  — change to existing behavior
  removal       — deletion / deprecation of existing capability
  refactor      — internal cleanup, no behavioral change intended
  bugfix        — defect repair (Intent should include reproduction)
  schema        — database schema change (still requires explicit user approval before migration)
  tooling       — dev workflow / build / agent infrastructure
  spike         — time-boxed exploration

state values (passive markers, not gates):
  working       — change-unit is being built or iterated on
  paused        — work suspended; reason in Worklog
  done          — change-unit shipped (committed/merged)
  abandoned     — work halted permanently; reason in Worklog

There is no "approved" or "verifying" state. The SPEC is not a workflow gate —
it is a journal. The human can override, commit despite warnings, ignore the
SPEC, or never look at it. Claude maintains it regardless.
-->

<!-- AUTO:CARD — overwritten by the auditor on every run -->
## CARD

_no audit run yet_

<!-- /AUTO:CARD -->

## Intent

<!--
1–3 paragraphs. Adapt to type:

  feature       — what & why; who benefits; what becomes possible
  modification  — what changes about existing behavior + why
  removal       — what goes away; migration story for callers
  refactor      — what gets cleaner; what must NOT change behaviorally
  bugfix        — symptom + reproduction steps + root-cause hypothesis
  schema        — what changes; what data/queries are affected; risk
  tooling       — what dev workflow improves; for whom
  spike         — question being explored; what "done enough" looks like

Business-level. No file paths, no code, no API signatures here.
Claude drafts this from the conversation. The human can correct it.
-->

## Scope

**In**
- bullet of what IS being changed

**Out**
- bullet of what is explicitly NOT being changed

<!--
The "Out" list is the strongest defense against scope creep.
Even when items feel obvious, write them down.
-->

## Decisions

<!--
≤5 bullets. Each: chosen approach + 1–2 rejected alternatives + why.
Architecture-level only. No code, no file paths, no signatures.
-->

## Acceptance Criteria

<!--
Plain-English bullets describing what success looks like for this change-unit.

These are documentation of intent for humans and future LLM passes — they help
the spec agent and the human reason about what the change is supposed to
achieve. They are NOT executable verifiers. The auditor (currently
architectural-review only) does not run them.

Functional verification (matching the diff to these claims, behavior probing,
scenario verification) is a future phase. For now: write them clearly, keep
them honest, refer to them when reviewing the diff.

Examples:
- A new human registering through the form ends up with an active principal,
  password credential, and a default entitlement.
- The /policies endpoint returns 401 when called without authentication.
- All callers of usePolicyV1 are removed.
-->

- ...

## Tasks

<!--
Checklist. Each task: imperative one-line description + owner agent.
Owners: archie | donnie | nexus | frankie | spec | auditor | (other)
Tasks live HERE — no separate task files.
-->

- [ ] T1 — description (owner: agent)

## Change Log

<!--
Append-only, file-level. ADD / MOD / DEL prefix.
Implementing agents update this as they work.
This is the artifact a reviewer reads to understand the surface area.
-->

<!-- AUTO:WORKLOG — appended (never overwritten) by the auditor on every run -->
## Worklog

<!-- /AUTO:WORKLOG -->

<!-- AUTO:VERDICT — overwritten by the auditor on every run -->
## Verdict

_no audit run yet_

<!-- /AUTO:VERDICT -->
