---
description: "The engineering mindsets every coding agent and the auditor apply on every turn. Not mechanical rules — principles. How a senior full-stack engineer thinks about good software. Loads unconditionally for every agent on every turn."
---

# architecture.md — the engineering mindsets

This file is the canonical philosophy for everyone who writes or reviews code in this project. It is **not** a list of mechanical do-this/don't-do-that instructions — those live in the per-stack rule files (`ddd-architecture.md`, `react-components.md`, `server-actions.md`, etc.) and per-agent rule files (`donnie-rules.md`, `nexus-rules.md`, etc.).

This file is the **why** behind those rules. The mindsets a principal engineer carries into every change, regardless of layer, language, or framework. If a specific rule does not exist for the situation you face, these mindsets are the fallback: ask what a senior engineer would do, then do it.

The auditor reads this file on every audit and checks whether the diff demonstrates the mindsets — not by mechanical pattern match, but by reading like a reviewer.

---

## 1. Encapsulation — hide what callers shouldn't know

Every module, function, and type exposes the smallest surface that satisfies its consumers. Internal mechanics, helper functions, database queries, third-party SDK shapes — none of these leak past the boundary.

**Why:** Encapsulation is what lets you replace a module without rewriting the world. The day you need to swap your ORM, your auth provider, your queue — you'll be glad your callers never depended on the inner shape.

**Concrete expressions:**
- Public APIs are explicit (named exports of a small set of functions and types). Everything else is private.
- Helpers live next to their callers. A function used by one file does not become a shared utility "in case someone else needs it."
- Internal types do not appear in public signatures. Internal errors map to domain errors at the boundary.
- Modules talk to each other through their public surface only. Reaching into another module's internals is a smell, even when the language permits it.

A reviewer flags: leaked internal types, exported-but-private helpers, hard imports across boundaries that should go through a port, callers that know more than they need to.

---

## 2. Security — trust nothing at the edge; trust everything you compute

The dividing line is the **trust boundary**. Outside the boundary (HTTP requests, webhook payloads, form data, env vars, third-party API responses, user input) you trust nothing — validate, sanitize, escape. Inside the boundary (your domain functions called by your own use cases) you trust everything — types and invariants carry the meaning.

**Why:** Defensive programming at every layer means every layer pays the cost (slow code, noisy errors, untestable branches). Defensive programming only at the edge means the cost is paid once and the inside stays clean.

**Mindset checks:**
- Inputs to server actions, route handlers, and webhook receivers are validated for shape and presence before reaching use cases. Use cases trust their inputs.
- IDs of authenticated principals come from the session — never from client-supplied `FormData`, `searchParams`, or request body. Client-supplied IDs identify nothing.
- Secrets (passwords, tokens, API keys, OAuth client secrets) never appear in log lines by value. Their presence may be logged; their value, never.
- Errors returned to the client carry mapped error codes, not raw internal messages — they don't echo back unvalidated input.
- Public-facing endpoints rate-limit.
- Authorization is enforced inside the use case (the safety net), not only at the route handler (the gate). Both are required.

A reviewer flags: client-trusted IDs, secret-leaking log lines, error responses that echo input, missing rate limits on internet-facing endpoints, authorization at the edge only.

---

## 3. Pure core, imperative shell

Decision logic — the part that decides what should happen — belongs in pure functions over plain values. The shell — the imperative orchestration that calls those functions and then executes their results via repositories, side effects, and external calls — is humble. It dispatches; it does not decide.

**Why:** Pure decision logic is testable without infrastructure. It runs the same in every environment. When the shell breaks (a flaky external API, a renamed table), the decision logic survives.

**Mindset checks:**
- Conditional branches that construct domain types inline, or encode rules ("if X is null, escalate to founder"), belong in pure functions in `domain/`. The shell calls them and dispatches on the result.
- Switch arms over a discriminated union should be one-line dispatches per arm, not blocks of inline orchestration. The interpretation of each case is a pure function.
- If your use case file is much longer than the domain functions it orchestrates, your policy has migrated into the shell.

A reviewer flags: long use case files with embedded conditional logic, inline construction of domain types in `application/`, multi-line switch arms doing inline side effects.

---

## 4. Composition over inheritance, explicit dependencies

Build behavior by composing functions, not by extending classes. Inject dependencies as explicit function parameters, not via shared state or module-level singletons. Higher-order factories beat service classes.

**Why:** Composition is granular — you can substitute one collaborator without dragging in a parent class's worth of behavior. Explicit dependencies make tests trivial: pass in fakes. Hidden dependencies (module-level instances, singletons) couple your tests to your runtime.

**Mindset checks:**
- Use cases are factories: `make{Verb}{Entity}UseCase(deps) → async (input) → Result<...>`. Not classes.
- Service / controller / manager / handler / provider class patterns are antipatterns here.
- Modules use plain object types for repository interfaces, not interface inheritance hierarchies.

A reviewer flags: any `export class XService`/`XController`/`XManager`/`XHandler`/`XProvider`, module-level singletons assumed to exist, hidden dependencies in use case implementations.

---

## 5. Result types over exceptions across boundaries

Functions that can fail return `Result<T, E>`. Exceptions are reserved for programmer errors (assertions, contracts violated by callers) and unrecoverable infrastructure failures (out of memory, DB connection lost mid-operation).

**Why:** Exceptions escape the type system. A function that throws says nothing in its signature about what can go wrong; callers either know magically or get surprised in production. `Result<T, E>` makes failure a first-class part of the API — callers must handle it.

**Mindset checks:**
- Domain functions return `Result<T, E>` instead of throwing for expected error paths (validation failures, business-rule rejections).
- Use cases return `Result<T, E>` to callers.
- Repository methods may throw on infrastructure failure (DB down, network gone); use cases catch and map to domain errors.
- `try/catch` blocks either log + transform to a `Result`, or rethrow. Empty catches swallow problems silently and are forbidden.

A reviewer flags: domain functions throwing instead of returning Result, use cases letting raw infrastructure errors escape, empty `catch` blocks, callers ignoring the failed branch of a Result.

---

## 6. Idempotency on retriable handlers

Any code path invoked by a webhook, queue consumer, scheduled job, or other retriable trigger MUST be idempotent. The contract "this event may be delivered twice" is not an edge case — it is the default contract of distributed systems.

**Why:** Networks fail, providers retry, queues redeliver. Code that creates two of everything when called twice will eventually be called twice in production. The cost of idempotency is one uniqueness check; the cost of duplicate side effects is impossible to reverse.

**Mindset checks:**
- Webhook receivers verify (signature/origin) before parsing payload, then check for prior execution by natural key before side-effecting.
- Idempotency is enforced at the layer that creates the side effect, usually via a unique constraint at the schema layer on the natural key.
- "Fire-and-forget" without idempotency is a latent bug, regardless of whether anyone has hit it yet.

A reviewer flags: webhook handlers without signature verification, queue consumers that insert without checking prior execution, side effects with no schema-level uniqueness on the natural key.

---

## 7. Observable systems — structured signals at boundaries

Every boundary call (HTTP in, HTTP out, DB query in a hot path, external SDK invocation) emits a structured signal. Logs are not strings; they are events with named fields.

**Why:** Production debugging without structured signals is reading needles in haystacks. With correlation IDs and event types, "what happened to user X at 14:32 UTC?" is a one-grep answer.

**Mindset checks:**
- Server actions and route handlers log entry (with input shape, not values) and exit (with success/error code).
- Repositories log slow queries, retries, external API calls — as structured events.
- A correlation ID flows through every layer of a single request.
- Critical paths report errors to a sink (Sentry, Datadog, equivalent) before mapping to a user-safe error.

A reviewer flags: `console.log` of strings instead of structured events, missing correlation IDs on cross-layer orchestrations, swallowed errors without reports.

---

## 8. No half-finished work

A change either ships complete or doesn't ship. Stubs that throw "not implemented," dead exports, commented-out "future use" code, half-migrated patterns where some callers use the new API and others use the old — none of these belong in a merge.

**Why:** Half-finished work is technical debt with no champion. The author moves on; the reader inherits ambiguity. Stale code rots faster than living code because nobody knows whether it's load-bearing.

**Mindset checks:**
- Every export has at least one in-repo consumer.
- Every import is referenced.
- Every parameter is read, or is intentionally prefixed with `_`.
- Block comments describing behavior match the post-edit code (no stale "Algorithm:" headers).
- A refactor that orphans code removes the orphans in the same change-unit.
- "Kept for future use" code is deleted now; reintroduce when the future arrives.

The build-check Stop hook enforces this mechanically via `tsc --noUnusedLocals --noUnusedParameters`. The auditor cross-checks for orphan exports and stale comments.

A reviewer flags: TS6133/TS6196 hits, exported-but-unused symbols, stale block-comment headers, half-migrated patterns visible across the diff.

---

## 9. No premature abstraction

Three similar lines are better than a premature abstraction. A new helper extracted into `packages/shared/` for one caller is a debt; for two, an open question; for three, possibly justified.

**Why:** Abstractions paid for in advance are paid for forever — every reader pays the cost of indirection. The actual shape of the right abstraction usually emerges only after three concrete uses have revealed what varies and what stays constant. Abstracting earlier locks in the wrong shape.

**Mindset checks:**
- A new shared helper with one caller → push back; let the duplication live until the second or third use.
- A new abstraction with two distinct callers → concern; verify the callers truly want the same thing.
- "I'll need this later" → not a justification.

A reviewer flags: single-caller extractions to `packages/shared/`, abstractions added without ≥2 concrete consumers, generic interfaces with one implementation.

---

## 10. Code is communication

The reader is the audience. The compiler is a side effect. Code is written once and read many times — the seconds saved at write time are paid back in hours at read time.

**Why:** Most code dies of unreadability, not bugs. The team that can read its own codebase fast ships faster, debugs faster, hires faster.

**Mindset checks:**
- Names are precise nouns and verbs. `processData` is a placeholder; `validateEmail` is a name.
- Functions do one thing the name implies, end-to-end.
- The shape of a file matches the shape of the concept it represents.
- A comment earns its place only when the *why* is non-obvious. The *what* belongs in the code itself, in well-named identifiers.
- A reader landing on a function should be able to predict its body from its name and signature.

A reviewer flags: generic names (`process`, `handle`, `manage`, `data`, `info`), functions that do three things, files that mix concerns, comments restating what the code already says.

---

## 11. Resilience and graceful degradation

Systems fail. Networks blip, providers throttle, dependencies go down. Code that pretends failure doesn't exist will fail spectacularly the moment reality intrudes. Code that anticipates failure degrades gracefully — partial data, queued retries, friendly error states — and keeps the user moving.

**Why:** A 99.9%-up dependency means your service is down 8.76 hours a year, distributed unpredictably, unless you handle its failure. The cost of a missing timeout is requests stacking up until threads exhaust; the cost of a missing retry is one-blip-fails-everything; the cost of a missing circuit breaker is one slow dependency dragging your entire system into the mud. Resilience is paid for in advance, by small additions to each call site, or paid for in retrospect, by 3am pages.

**Mindset checks:**
- Every external call (HTTP, DB, third-party SDK, file system, anything off-process) has an explicit timeout. The default is wrong.
- Retries use exponential backoff with jitter, capped at a small number of attempts. Tight retry loops on a flaky dependency make the flakiness worse for everyone.
- Failures degrade gracefully. The hero feature works; secondary widgets show "couldn't load" instead of taking the whole page down. Idempotent retries are safe (see §6).
- Blast radius is considered before merge. "If this code path fails for one user, does it fail for all users? for one tenant? for one feature?" Bound the blast radius narrowly.
- Hard dependencies (must succeed for the request to complete) are the minimum; soft dependencies (nice-to-have, render without them on failure) are the default for non-critical data.

A reviewer flags: `fetch()` / DB call / SDK invocation without a timeout, raw exceptions bubbling to the user instead of degraded UI, tight retry loops without backoff, single-points-of-failure on non-critical paths.

---

## 12. Pragmatism and trade-offs

The right answer to most engineering questions is "it depends." Knowing what it depends on is the job. Build vs buy, simple vs general, ship now vs polish, measure vs assume — these are not technical decisions; they are judgment calls about cost, risk, and timing.

**Why:** Engineering culture often rewards "the right way," but the right way is contextual. A pattern that's optimal at one scale is overkill at another. Optimization that wasn't needed taxes every reader forever. Generality that wasn't earned is dead weight. The expensive mistakes are the ones that look principled — abstractions added speculatively, frameworks chosen for resume-driven reasons, performance work done without measurement. Pragmatism is recognizing when "good enough that ships" beats "perfect that doesn't."

**Mindset checks:**
- "What's the simplest thing that could work?" — ask before the elaborate thing.
- "Have we measured this is actually slow?" — optimization without measurement is decoration.
- "Could we ship the 80% solution and learn from real usage?" — real users surface real requirements; speculation surfaces speculative ones.
- "Is this a problem we have, or a problem we might have?" — solving might-have problems is how codebases accumulate weight.
- "Build vs buy?" — if a battle-tested library exists and fits, use it. Don't NIH-rewrite to feel productive.
- Three concrete uses before abstracting (echoing §9). The right shape of an abstraction emerges only after the variability is real.

A reviewer flags: speculative complexity, premature optimization without measurement, custom solutions where a known library fits, abstractions added before the second consumer exists, "we might need this" code that never gets needed.

---

## 13. Long-term maintainability

Code outlives its author. The maintainer in six months — possibly you, possibly someone who's never seen this code — is the audience that matters most. A change that ships and breaks the next engineer has paid forward a debt that compounds.

**Why:** Velocity over the long run comes from a codebase that doesn't fight back. Maintainability is what determines whether next quarter's features take days or weeks. The cost of an unmaintainable system is measured in engineer-months: a 2x slowdown in shipping, paid every quarter, forever. The fix is paying small attention costs continuously — clear names, intentional deprecation paths, migration guides, version discipline — instead of one giant rewrite later.

**Mindset checks:**
- "Will this make sense to someone who joined the team tomorrow?"
- Breaking changes have a migration path. The old API doesn't disappear in one merge; it deprecates, with a clear path to the new shape, then disappears in a later merge.
- Public APIs are stable on purpose. The shape of an exported function is a promise to every consumer; changing it casually breaks them all silently.
- Comments explain *why* — the constraint, the deal made, the surprise. The *what* lives in identifiers.
- "Six-months-from-now" test: imagine yourself returning to this code with no memory of writing it. Would you be able to change it safely? If not, fix it now.

A reviewer flags: breaking changes without deprecation paths, public APIs reshaped without consumer migration, comments that document what (already in code) instead of why, code that depends on memory of the meeting that produced it.

---

## 14. Debuggability — design for the 3am page

When something breaks in production, the time it takes to diagnose is determined by decisions made when the code was written. Logs without context, errors without operations, stack traces that point to symptoms instead of causes — each one adds minutes to the incident, multiplied by every responder, multiplied by every recurrence.

**Why:** Mean time to recovery is a business metric. A 30-minute outage with good observability is a hiccup; a 30-minute outage that *takes another 90 minutes to root-cause* is a story told for years. Debuggability is the difference. It is built at write-time by the engineer who will *not* be on call when it breaks.

**Mindset checks:**
- Error messages carry context: what was being attempted, what input failed, what the next step is. `"Validation failed"` is useless; `"Invalid email format for input 'user@@example.com' in registerPrincipal"` is debuggable.
- Logs answer "what happened to user X at 14:32 UTC?" in one grep. Correlation IDs flow through every layer of a single request.
- Stack traces point to actual causes, not just the layer where the error surfaced. Re-throwing without context is throwing away the diagnosis.
- The "3am page" test: would I want this signal at 3am? If the alert would land without enough context to act on, the observability is wrong.
- Reproducibility: failed operations log enough state that a developer can recreate the failure locally. Not the user's password, but the inputs that triggered the bug.

A reviewer flags: error messages of the form "Something went wrong" / "Operation failed", empty `catch` blocks that swallow context, logs as unstructured strings, errors thrown without operation/input context, alerts that fire without enough information to act on.

---

## 15. Risk management — small reversible steps

Every change carries risk. Big-bang deploys, irreversible schema migrations, "fire and forget" rollouts of large features — these maximize the chance that something breaks while minimizing the chance you can fix it quickly. The disciplined alternative: small reversible steps, feature flags, rollback plans written before deploy, blast radius declared out loud.

**Why:** Production is the only environment that matters, and it never matches staging perfectly. The reliable strategy is to assume changes will surface unknowns, and to make those unknowns cheap to discover. A change shipped behind a feature flag, rolled out to 1%, then 10%, then everyone, surfaces problems while only 1% of users see them. A change shipped to everyone surfaces problems with everyone affected.

**Mindset checks:**
- Before merging anything non-trivial: declare blast radius. "About to deploy X. Affects Y users / Z paths. Reversible: yes/no, time-to-rollback: N minutes."
- Risky changes ride behind feature flags. The flag flips off in under a minute when something goes wrong. The flag is removed (and the gate removed) only after the change has soaked.
- Schema migrations follow the multi-step pattern (archie-rules §5): add nullable, backfill, deploy app that dual-writes, deploy app that reads new, drop old. Never the one-step destructive migration.
- Rollback plan documented before deploy, not invented during the incident. "If this breaks at 3am, what do I do?" — the answer should be on a runbook, not in someone's head.
- Don't deploy on Friday afternoon unless you're prepared to debug on Saturday.

A reviewer flags: big changes shipped without feature flags, schema migrations in a single destructive step (caught by archie-rules), changes that lack a documented rollback path, deploys that ignore blast radius.

---

## 16. High agency — own the problem, not the ticket

High-agency engineers solve the problem in front of them, even when the problem turns out to be different from what the ticket described. They ask questions when the spec is wrong. They fix the broken thing they noticed along the way, or they file it. They don't silently implement nonsense because that's what was asked for.

**Why:** Specs are written by humans who don't have full information. The engineer doing the work usually discovers something the spec author didn't know. Implementing the spec verbatim — when you can see it's wrong — is a failure mode that costs everyone: the spec author (didn't get useful feedback), the user (got the wrong thing), the next engineer (inherited the nonsense). Surfacing the question is a small short-term cost for a large long-term benefit.

**Mindset checks:**
- When the spec doesn't match reality, push back before coding. Ask. The cost of asking is minutes; the cost of building the wrong thing is days.
- When you find a bug along the way, you have two choices: fix it (if it's in scope and small) or file it (if it's not). The forbidden choice is to silently route around it.
- Workarounds without follow-up are debt with no creditor. Either fix the root cause or document why the workaround is the right answer for now.
- "What's actually broken here?" — diagnose before you patch. The fix that addresses the symptom but not the cause is a fix that will be needed again.
- Make the implicit explicit. If you're assuming X, say so. If you're guessing, say "I'm guessing" instead of stating it as fact.

A reviewer flags: specs implemented verbatim despite obvious issues; workarounds without follow-up tickets/comments; root causes addressed at symptom level; assumptions baked silently into code; TODOs that have no owner or no clear next action.

---

## 17. Empathy for future maintainers

Future maintainers — including you in six months — will read this code with no memory of writing it. The mental cost they pay is set by the writer. Code that's clever for the writer is often opaque for the reader; code that's clear for the reader is often unremarkable for the writer. Choose for the reader.

**Why:** Codebases mature through reads, not writes. Every line you write will be read many times — during debugging, during onboarding, during refactors. The hour spent making a function self-explanatory saves cumulative days of confusion downstream. Empathy is not a soft skill; it's a velocity multiplier.

**Mindset checks:**
- "Could a new engineer joining tomorrow understand this in five minutes?" If not, make it more obvious.
- Don't be clever. Cleverness costs the reader; clarity costs the writer one extra minute. The writer is paid better — they win the trade.
- Naming carries weight. `x`, `data`, `result`, `manager` — these are placeholders. `principalId`, `validatedEmail`, `dispatchResult`, `idempotencyToken` — these are names.
- Surprises deserve comments. The non-obvious constraint, the historical workaround, the "we tried it the other way and here's why we don't anymore" — these earn their place in code comments. Restatement of what the code does — does not.
- Leave the campsite cleaner than you found it. Small drive-by improvements to readability, fixed alongside the change you're making, compound. A codebase where every contributor improves readability ages well.

A reviewer flags: code that requires a paragraph of explanation to read; magic numbers without comments; abbreviations only the author understands; functions that change meaning based on context (`process` called from three places, doing different things); cleverness chosen over clarity.

---

## How principles get added — the extension mechanism

This file is not theoretical. Every principle above was earned — distilled from a real situation where the absence of the principle caused a real problem. New principles join this file by the same path.

The procedure:

1. **Document the incident or the pattern.** What failed? When? Why? What would have prevented it? If this is the third time the same shape of problem has appeared, that's the signal — a pattern exists.
2. **Distill the rule.** Compress the lesson into a one-sentence principle a senior engineer would carry into every change.
3. **Write the "Why".** The rationale. Not "because it's good practice" — the actual cost the principle exists to prevent.
4. **Write the mindset checks.** What does an engineer carrying this principle ask themselves while writing? What does a reviewer look for?
5. **Add it as a new numbered section.** The file accumulates. Existing sections are not deleted; their numbers are stable so cross-references in other files stay valid.
6. **Optional but recommended: cite the earned-by moment.** Add a note like _"Earned by: the brain router rescue path, 2026-05"_ — a small fossil of where the principle came from. Future readers benefit from knowing the principle is scar tissue, not theory.

The file should grow over years. Twenty principles will not be too many if each one represents a real lesson. The cost of an extra principle is small (one read per audit); the value of a missing one is large (one repeated mistake per quarter).

Principles are not invented from theory. They are fossilized from situations the team lived through. This file is the project's institutional memory of what good engineering means *here*.

**Cross-project propagation.** Nucleus distributes this file to every downstream project. New principles added here propagate via `nucleus update`. Downstream projects may add their own principles too — those local additions live in their own copy of the file and don't propagate back unless the principle is contributed back to Nucleus. Local principles should follow the same pattern (earned, rationaled, checked).

---

## How the auditor uses this file

The auditor reads this file on every audit, then reads the specific rule files (per-stack, per-agent) the diff triggers. Specific rules are mechanical and unambiguous; this file is the mindset behind them.

When a specific rule does not exist for a situation, the auditor applies the mindsets above. The verdict cites the mindset by section number (e.g., "architecture.md §3 — pure core / imperative shell").

The auditor does not soften severity on mindset-driven findings. A diff that violates a mindset is a violation, even if no specific mechanical rule fires.

---

*This file is the project's engineering philosophy. Update it when new principles emerge from real situations — not on speculation. Specific mechanical rules live in the per-stack and per-agent rule files; this file is why they exist.*
