---
name: pm
description: |
  The project-management process for this repo: the spine (roadmap + initiatives + decisions), the leaves (SPEC.md), and the deterministic index (state.json). Load this when planning, sequencing, grouping work into initiatives, defining the roadmap, recording cross-cutting decisions, or running/understanding the Captain compiler. Defines the file schemas, the state.json contract, the validation rules, the seven-priority gap ranking, and how the layers relate to the spec/auditor/orchestrator split.
---

# The PM process (Captain)

Four fenced layers, each with a different epistemic status. Keep them separate. They never overlap, and the agent surface that owns each layer never crosses into another.

| Layer | Artifact | Status | Owner | Answers |
|---|---|---|---|---|
| **Leaf** | `system/context/{module}/features/{slug}/SPEC.md` | working memory — mutable, overridable | `spec` agent | "Is this change done?" |
| **Spine** | `system/roadmap.md` + `system/initiatives/INIT-*.md` + `system/decisions/DEC-*.md` | committed plan-of-record — **not** ignorable | **Captain** | "Where are we going, in what order, and what cross-cutting calls have we made?" |
| **Index** | `system/state.json` | derived, deterministic | compiler (`.claude/scripts/captain-compile.mjs`) | "What is the state of everything, right now?" |
| **Verdict** | `<!-- AUTO:CARD -->` / `<!-- AUTO:VERDICT -->` / `<!-- AUTO:WORKLOG -->` blocks in SPEC.md | per-diff architectural review | `auditor` agent | "Did the last change-unit follow the rules?" |

**Jurisdiction is fenced — no overlap:**

- `spec` owns leaves. Captain reads them via `state.json`; never edits them.
- `auditor` owns the AUTO blocks. Captain reads the harvested verdict from `state.json`; never edits those blocks.
- `orchestrator` decides what happens next (dispatch agents, ask the human, commit). Captain proposes; orchestrator decides.
- **Captain owns the spine** and *interprets* the index.

---

## 1. Leaf — `SPEC.md` (working memory, mutable, overridable)

One file per change-unit, owned by the `spec` agent. It answers *"is this change done?"* Frontmatter is the structure Captain reads:

```yaml
id: <module>-<slug>          # stable join key, never reused
type: feature | modification | removal | refactor | bugfix | schema | tooling | spike
state: working | paused | done | abandoned
created: YYYY-MM-DD
updated: YYYY-MM-DD
```

Captain also reads the auditor's verdict harvested from the `<!-- AUTO:VERDICT -->` block (falling back to `<!-- AUTO:CARD -->`), normalised to `PASS | PASS_WITH_NOTES | FAIL | BLOCK | null`.

Leaves live at `system/context/{module}/features/{slug}/SPEC.md` (or `system/context/{module}/SPEC.md` for module-scoped change-units). **Captain never edits leaves.**

---

## 2. Spine — roadmap + initiatives + decisions (committed plan-of-record, NOT ignorable)

This is the layer SPEC deliberately lacks. It answers *"where are we going, in what order, and which cross-cutting calls bind the project?"* Owned by Captain.

### 2.1 `system/initiatives/INIT-NNN-<slug>.md`

An initiative groups SPECs into a coherent outcome. It is the unit the roadmap operates on.

```yaml
id: INIT-NNN
title: <short outcome>
status: proposed | active | done | parked | dropped
horizon: now | next | later
owner: <name>
opened: YYYY-MM-DD
target: YYYY-MM-DD        # optional, soft — a flag if missed, not a failure
specs: [<spec-id>, ...]   # the leaves this initiative groups
```

Body: `## Outcome` (what "done" means, one paragraph) and `## Why now`. Nothing more.

**The horizon lives here, on the initiative — not duplicated in the roadmap.** Single source of truth; the index derives the roadmap grouping from these fields. This is the anti-drift rule: status and horizon are stored once, in the thing they describe.

### 2.2 `system/roadmap.md`

Human narrative only. Prose describing direction by horizon. It carries no authoritative structure — the structure is computed from the initiatives. Mention each active/proposed initiative by `id` so the narrative stays honest (the compiler flags any that drift out).

### 2.3 `system/decisions/DEC-NNN-<slug>.md`

A cross-cutting architectural decision that spans multiple initiatives or shapes the project's overall direction. Distinct from the per-SPEC `Decisions` section, which lives inside one change-unit's working memory.

```yaml
id: DEC-NNN
title: <short outcome>
status: proposed | accepted | superseded | deprecated
decided: YYYY-MM-DD
owner: <name>
supersedes: [DEC-NNN, ...]   # optional — when this one replaces an earlier call
relates: [INIT-NNN, ...]     # optional — which initiatives this decision binds
```

Body: `## Context` (what called for this decision), `## Decision` (what was decided), `## Consequences` (what now becomes true, what gets harder, what we'll re-evaluate).

DECs are the project's persistent architectural memory — they survive past the initiative that produced them. A new SPEC that would contradict an accepted DEC must explicitly supersede it.

---

## 3. Index — `system/state.json` (derived, deterministic, the query surface)

Generated by `.claude/scripts/captain-compile.mjs`. Never hand-edited. It is a pure function of the spine + leaves, so it cannot lie. Agents read it instead of digging. Shape:

```jsonc
{
  "generated": "<ISO timestamp>",
  "asOf": "YYYY-MM-DD",
  "horizons": {
    "now": [<initView>], "next": [...], "later": [...]
  },
  "initiatives": { "INIT-001": { "id","title","status","horizon","owner","target","specs":[],"specStates":{} } },
  "specs":       { "<spec-id>": { "id","type","state","created","updated","verdict","path","initiative" } },
  "decisions":   { "DEC-001":  { "id","title","status","decided","owner","supersedes":[],"relates":[] } },
  "rollup": { "specs": {<state>:N}, "initiatives": {<status>:N}, "decisions": {<status>:N} },
  "violations": [ { "code","level":"violation","id","message" } ],
  "flags":      [ { "code","level":"flag","id","message" } ],
  "healthy": <violations.length === 0>
}
```

---

## 4. The compiler

Lives at `.claude/scripts/captain-compile.mjs`. Zero dependencies, plain Node ESM.

```
node .claude/scripts/captain-compile.mjs --root .              # CI: write state.json, report, exit 1 on violations
node .claude/scripts/captain-compile.mjs --root . --quiet      # PostToolUse hook: refresh silently, exit 0
node .claude/scripts/captain-compile.mjs --root . --summary    # SessionStart: print status as context
node .claude/scripts/captain-compile.mjs --root . --json       # print full state.json (piping / portfolio rollup)
node .claude/scripts/captain-compile.mjs --root . --strict-flags     # also fail CI on soft flags
node .claude/scripts/captain-compile.mjs --root . --today 2026-06-02 # fixed clock for reproducible tests
```

Paths and the staleness threshold are overridable via `captain.config.json` at repo root:
`specsDir`, `specFile`, `initiativesDir`, `decisionsDir`, `roadmapFile`, `out`, `staleDays`. Defaults match the layout above.

---

## 5. Validation rules (complete)

### Violations — hard. Fail CI (exit 1). The index is structurally false.

**SPEC integrity:**
- `spec-no-id`, `spec-no-state`, `spec-bad-state`, `spec-bad-type`, `spec-no-updated`, `spec-dup-id`

**Initiative integrity:**
- `init-no-id`, `init-no-status`, `init-bad-status`, `init-no-horizon`, `init-bad-horizon`, `init-dup-id`
- `init-broken-link` — initiative references a SPEC id that does not exist

**Decision integrity:**
- `dec-no-id`, `dec-no-status`, `dec-bad-status`, `dec-dup-id`
- `dec-broken-supersede` — decision supersedes an unknown decision id

### Flags — soft. Captain triages; do not fail CI unless `--strict-flags`.

- `spec-orphan` — an open (`working`/`paused`) SPEC belonging to no initiative
- `spec-stale` — a `working` SPEC untouched > `staleDays`
- `spec-done-no-pass` — a `done` SPEC whose verdict is FAIL/BLOCK/absent
- `init-off-track` — an `active` initiative past its `target`
- `init-now-idle` — an `active` now-horizon initiative with no in-flight SPEC
- `init-completable` — an `active` initiative whose SPECs are all done/abandoned
- `init-not-on-roadmap` — an active/proposed initiative absent from the roadmap narrative
- `empty-now-horizon` — nothing active on the now horizon
- `no-initiatives`, `no-roadmap`

---

## 6. The seven-priority gap ranking

Captain triages flags and violations in this exact order. The order is non-negotiable: do not let stale specs drown out broken links.

1. **Violations** — broken links, bad enums, duplicate ids, missing required fields. The plan is structurally false.
2. **Now-idle** — `now`-horizon active initiative with no in-flight SPEC. The project claims to be doing something it isn't.
3. **Off-track** — `active` initiative past `target`. Name the slip in days.
4. **Done-no-pass** — `done` SPEC without a `PASS`/`PASS_WITH_NOTES` verdict. Quality debt masquerading as progress.
5. **Orphans** — open SPECs belonging to no initiative. Either it matters (give it a home) or it doesn't (why is it being built?).
6. **Drift** — `init-not-on-roadmap` — active/proposed initiative absent from the roadmap narrative.
7. **Stale** — `working` SPECs untouched > `staleDays`. Lowest priority; often benign.

---

## 7. The governing principle

**Determinism detects; the agent judges.** Everything mechanical lives in the compiler and runs on every write and in CI, so it never drifts and costs no tokens. Captain reasons on top of the compiler's output. That is why Captain never has to dig, and why "is the project consistent?" is an exit code, not an opinion.

---

## 8. Portfolio (future)

Every Nucleus-based repo emits `state.json` at the same path with the same schema. A portfolio rollup across many projects is one scheduled headless run that fetches each `state.json` and merges `horizons` / `violations` / `flags` — no central database. Out of scope for Phase 1; the schema is shaped to support it later.

---

## 9. Relationship to the existing agents

- **`spec`** owns one SPEC.md per change-unit. Silent by default, interactive on `/spec`. Captain reads its output; never edits.
- **`auditor`** owns the per-diff architectural review and writes `AUTO:CARD` / `AUTO:VERDICT` / `AUTO:WORKLOG` into the matching SPEC. The compiler harvests the verdict and exposes it through `state.json`. Captain reads that; never edits the blocks.
- **`orchestrator`** dispatches all of the above. Captain proposes spine fixes; the orchestrator decides whether to apply them, whether to dispatch `spec` for a new change-unit, or whether to surface the gap to the human first.
- **Implementing agents** (`archie`/`donnie`/`nexus`/`frankie`) never interact with Captain directly. They write code per the SPEC; the auditor reviews; Captain reads the resulting `state.json` on the next pass.
