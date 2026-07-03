<!--
SPEC.md — working memory for one change-unit.

Lives at: system/context/app/features/migrate-on-deploy/SPEC.md

This is an APP-WIDE, CROSS-CUTTING deploy-pipeline concern, not a bookings
sub-feature. It runs BOTH drizzle migration sets — bookings (drizzle.config.ts)
and audit (drizzle.audit.config.ts) — as a gating step in the Vercel + Neon
deploy, so it belongs under system/context/app/ alongside access-gate and the
audit-log module rather than inside modules/bookings/.

It builds on the storage decisions in:
  - ../../../bookings/features/sqlite-to-postgres/SPEC.md — DEC-PG2 (Neon),
    DEC-PG4 (drizzle-kit migrations are the schema lifecycle).
  - ../../../audit/features/audit-log/SPEC.md — the audit module ships a SEPARATE
    drizzle.audit.config.ts with its own module-local migrations dir.
Deploy target is Vercel + Neon per infra/_kit/manifest.yaml (deploy_target: cloud).
-->

---
id: app-migrate-on-deploy
slug: migrate-on-deploy
module: app
type: tooling
state: working
created: 2026-07-03
updated: 2026-07-03
---

<!-- AUTO:CARD — overwritten by the auditor on every run -->
## CARD

## CARD — engineering review · 2026-07-03T00:00:00Z
**verdict** PASS with notes

**Changed files** 3
scripts/migrate-deploy.mjs
package.json
infra/README.md

**Findings** 0 violations · 0 concerns · 2 notes

Both prior WARN concerns are genuinely resolved. Prod+missing-direct → FATAL
exit 1, no pooled fallback (L160-170). Per-set 120s timeout → fail-closed,
names the set, aborts before the next set (L207-229). Every branch traced:
prod+direct→migrate; preview/dev/unset-VERCEL_ENV→skip exit0; non-Vercel→
prefer-direct-else-DATABASE_URL, fatal iff both empty; set-1 fail→exit before
set-2. No secret value is ever logged (§2). Child-only DATABASE_URL assignment
does not clobber app runtime pooled url (separate process). Idempotency intact
(drizzle-kit journal; no bespoke state). No dead code / premature abstraction.

### architecture — architecture.md
**Notes**
- scripts/migrate-deploy.mjs:210  spawnSync default SIGTERM kill on timeout; if a grandchild ignores it, parent still reports result.signal/ETIMEDOUT so fail-closed holds — surfaced for awareness (§11)
- scripts/migrate-deploy.mjs:210  `env: process.env` forwards full build env to the child (required for DATABASE_URL); stdio inherit does not echo env, no leak — note only (§2)

<!-- /AUTO:CARD -->

## Intent

The project now ships to Vercel + Neon (serverless Postgres) and its schema lifecycle is drizzle-kit migrations (sqlite-to-postgres DEC-PG4), not lazy bootstrap DDL. There are two independent migration sets: the bookings module (driven by `drizzle.config.ts`) and the audit module (driven by its own `drizzle.audit.config.ts`, kept separate to preserve module isolation). Until now nothing guaranteed those migrations were applied to the production database before new application code that depends on them went live — a classic deploy hazard where the code expects a column or constraint the database does not yet have.

This change-unit adds a **migrate-on-deploy** step: a script that applies **both** drizzle migration sets, run as a **gating** step in the deploy. Deploys are done by **Vercel's native Git integration**, so the migrate step is wired **into the Vercel build** via a `vercel-build` npm script (`node scripts/migrate-deploy.mjs && next build`); the `&&` makes it **fail-closed** — if migrations fail, `next build` never runs and no deploy is produced. The migrate step is **production-only**: it applies migrations only on a production Vercel build (`VERCEL_ENV === 'production'`) and skips (exit 0) on preview/development builds, so a preview never touches the production database. In production it uses the Neon **DIRECT** (non-pooled) url (`NEON_DIRECT_DATABASE_URL`); a missing direct url on a production build is **fatal** (no fallback to the pooled url, which pgbouncer transaction pooling breaks for the multi-statement migration session). If a migration fails to apply (including a data-incompatible migration such as tightening a CHECK constraint against rows that violate it), the build is blocked rather than allowed to ship code against an unmigrated or half-migrated database. This makes schema/code drift impossible to ship silently and makes data-incompatibility cheap to discover at deploy time instead of at 3am in production.

> **Pivot (2026-07-03):** this SPEC originally described a **GitHub Actions**–driven deploy that ran the migrate step and (on previews) a Neon-branch-per-PR database. That design was superseded — see DEC-MD1..DEC-MD4 (now SUPERSEDED) and DEC-MD5..DEC-MD10 below. The GitHub Actions workflow is retained but **disabled** at `.github/workflows/deploy.yml.disabled` (GitHub ignores non-`.yml`/`.yaml` files under `.github/workflows/`); it is a backup/reference only. The live path is the Vercel-native `vercel-build` script described above.

## Scope

**In**
- A migration runner script that applies BOTH drizzle migration sets (bookings via `drizzle.config.ts`, audit via `drizzle.audit.config.ts`), fail-closed on any error, with a production-only guard and a mandatory Neon DIRECT url on production Vercel builds.
- A `package.json` `vercel-build` script that runs the migrate step before `next build` (fail-closed via `&&`), plus a `db:migrate:deploy` script for manual/one-off runs.
- Documentation of the single Vercel Production env var the operator must set (`NEON_DIRECT_DATABASE_URL`) for the live Vercel-native path.
- The retained-but-disabled GitHub Actions workflow kept as a backup/reference at `.github/workflows/deploy.yml.disabled`.

**Out**
- No change to the schemas themselves — this change-unit runs migrations; it does not author them (archie owns schema; the migrations already exist per sqlite-to-postgres and audit-log).
- No change to application behavior, the availability engine, or the audit recording path.
- No cloud CLI execution by any AI agent — Neon/Vercel provisioning and env-var setting are operator actions (infra-commandments §4). The Vercel build reads the operator-provisioned env var at build time.
- No preview/branch migration and no Neon-branch-per-PR automation — that lived in the now-disabled GitHub Actions workflow. Previews are NOT auto-migrated (by design); they never touch the production database.
- No rollback automation — fail-closed means the build (and therefore the deploy) halts; recovery is an operator action.
- No merging of the two drizzle configs into one — they stay separate to preserve module isolation (the audit module owns its own migrations dir).

## Decisions

> **Note (2026-07-03):** DEC-MD1 remains in force (one runner, both sets, fail-closed). DEC-MD2 and DEC-MD4 are **SUPERSEDED** by the Vercel-native pivot (DEC-MD5..DEC-MD10); DEC-MD3 remains in force (fail-closed on data-incompatible migrations) with its delivery mechanism updated by DEC-MD6. DEC-MD11 adds a fourth fail-closed mechanism (a 120s per-set migrate timeout). The superseded decisions are kept below, annotated, for history.

- **DEC-MD1 — One runner applies BOTH migration sets, fail-closed.** A single script (`scripts/migrate-deploy.mjs`) runs the bookings migration set (`drizzle.config.ts`) and the audit migration set (`drizzle.audit.config.ts`) in sequence; any failure aborts with a non-zero exit so the caller treats it as a hard stop. _Rejected:_ two separate deploy steps that could partially succeed (a half-migrated database is worse than a blocked deploy); a single merged drizzle config (would write both modules' DDL into one journal, clobbering the audit module's isolation — see the audit-log Change Log, archie's note on why a separate config exists). _Why:_ both databases must be current together, and fail-closed is the only safe posture when application code is about to depend on the new schema (architecture.md §15 — small reversible steps; a blocked deploy is fully reversible, a shipped drift is not). _Still in force — the caller changed from CI to the Vercel build (DEC-MD5), but the one-runner/both-sets/fail-closed contract is unchanged._
- **DEC-MD2 — ~~Migrations gate the Vercel production promote; preview runs against a Neon branch.~~ SUPERSEDED by DEC-MD5 + DEC-MD7 + DEC-MD8 (2026-07-03).** _Original:_ The GitHub Actions workflow (`.github/workflows/deploy.yml`) runs `db:migrate:deploy` as a required step before promoting the Vercel production deployment. On preview deploys the same step runs against a Neon branch database, so a data-incompatible migration is caught on the branch before it can reach production. _Rejected (still valid):_ running migrations from the app at boot / first request against the shared cloud DB (a DDL-on-cold-start race); applying migrations manually before each deploy (unreliable, forgettable, invisible). _Superseded because:_ deploys are now Vercel-native (no GitHub Actions promote step to gate), so migrations moved into the Vercel build (DEC-MD5) and are production-only with no per-preview branch DB (DEC-MD7, DEC-MD8).
- **DEC-MD3 — Fail-closed is a feature, not a bug, for data-incompatible migrations.** A migration that cannot apply because existing data violates a new constraint (e.g. the bookings `quantity` CHECK tightened from `1..8` to `1..6` per reservation-pivot DEC-P10, against a row where `quantity > 6`) will fail the migrate step and block the deploy by design. The operator resolves the offending data first (for the DEC-P10 case: run `SELECT count(*) FROM bookings WHERE quantity > 6` against production before the first deploy; if `0`, it applies cleanly). _Rejected:_ making the runner tolerant / best-effort (a silently skipped migration is the drift this whole change-unit exists to prevent). _Why:_ the entire value is that drift and data-incompatibility surface at deploy time, loudly, before code ships (architecture.md §2 domain/schema trust boundary; §16 make-the-implicit-explicit). _Still in force — the block now manifests as a failed `vercel-build` (the `&&` prevents `next build`), instead of a failed CI step (DEC-MD6)._
- **DEC-MD4 — ~~The workflow requires six operator-set repo secrets.~~ SUPERSEDED by DEC-MD9 (2026-07-03).** _Original:_ The deploy workflow needs, and the operator must set: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (Vercel promote), and `NEON_API_KEY`, `NEON_PROJECT_ID`, `NEON_DIRECT_DATABASE_URL` (Neon branch + the direct — non-pooled — connection the migrator uses). _Rejected (still valid):_ baking any of these into the repo or an image (infra-commandments §4/§5). _Superseded because:_ the live Vercel-native path needs only ONE operator-set value — `NEON_DIRECT_DATABASE_URL` as a Vercel **Production** env var (DEC-MD9). The other five repo secrets are now relevant ONLY to the retained-but-disabled backup workflow (DEC-MD10), not the live path.

---

**Vercel-native pivot (2026-07-03) — DEC-MD5..DEC-MD10:**

- **DEC-MD5 — Deploys are Vercel-native; migrations run inside the Vercel build via `vercel-build`.** jet deploys through **Vercel's native Git integration** (Vercel builds + deploys the Next.js app on every push/PR); there is no GitHub Actions promote step. Migrations are wired into the build with a `vercel-build` npm script: `node scripts/migrate-deploy.mjs && next build`. The `&&` is the gate — if the migrate step exits non-zero, `next build` never runs and Vercel produces no deployment. _Rejected:_ keeping a parallel GitHub Actions pipeline just to run migrations (two pipelines racing the same DB; the native integration already builds and deploys — adding Actions only to migrate is redundant and error-prone); running migrations post-deploy from the app (the boot-time DDL race DEC-MD2 already rejected). _Why:_ with Vercel-native deploys, the build is the one place that reliably runs on every production ship, so it is the correct gate for "schema before code" (architecture.md §15 — the build is fully reversible; a shipped drift is not).
- **DEC-MD6 — Fail-closed is delivered by `&&` in `vercel-build` (build blocks, not a CI step).** The migrate step's non-zero exit stops the `vercel-build` chain before `next build`, so a failed migration blocks the whole build and no deployment is created. This is the DEC-MD1/DEC-MD3 fail-closed contract, re-homed from a CI job to the build script. _Rejected:_ running migrations as a separate Vercel "post-deploy" or ignoring the exit code (a deploy that ships anyway on a failed migrate is exactly the drift this SPEC exists to prevent). _Why:_ `foo && next build` is the simplest fail-closed primitive available in the build environment (architecture.md §9 — no premature abstraction; the shell `&&` is enough).
- **DEC-MD7 — Production-only guard: migrate iff `VERCEL_ENV === 'production'`.** Inside a Vercel build (`VERCEL === '1'`), the runner migrates ONLY when `VERCEL_ENV === 'production'`; preview/development (or an absent `VERCEL_ENV`) SKIP and exit 0 so the build proceeds without touching any database. Outside a Vercel build (`VERCEL` unset — local/manual), the guard is a no-op and migrations run as before. _Rejected:_ migrating on preview builds (there is no per-preview branch DB anymore — see DEC-MD8 — so a preview migrate would hit the PRODUCTION database, the worst possible outcome); a manual "is this prod?" flag (fragile, forgettable — the platform already tells us via `VERCEL_ENV`). _Why:_ previews must never mutate production data, and with no branch-per-PR automation the only safe preview behaviour is to skip (architecture.md §2 trust boundary; §15 blast-radius).
- **DEC-MD8 — Previews are NOT auto-migrated (no Neon-branch-per-PR automation).** The Neon-branch-per-PR rehearsal from DEC-MD2 is gone; it lived in the now-disabled GitHub Actions workflow. Preview deploys build and deploy the app but skip migrations entirely (DEC-MD7). _Rejected:_ re-implementing branch-per-PR inside the Vercel build (Vercel builds don't own Neon branch lifecycle; provisioning + tearing down a branch per preview is out of scope for a build script and is operator/infra territory). _Why:_ the value of preview rehearsal doesn't justify rebuilding branch orchestration in the build; production-only + fail-closed already prevents shipping drift (architecture.md §12 — pragmatism / trade-offs; §9 — don't rebuild the elaborate thing).
- **DEC-MD9 — DIRECT url required on production builds; a missing one is FATAL (no pooled fallback).** On a production Vercel build the runner requires `NEON_DIRECT_DATABASE_URL` (the Neon DIRECT, non-pooled url) and injects it as `DATABASE_URL` for the child drizzle-kit processes only; the app's runtime `DATABASE_URL` stays the POOLED url. A missing/empty connection string aborts fatally (exit 1) rather than falling back — because the pooled url would be the only alternative and pgbouncer TRANSACTION pooling breaks/hangs drizzle-kit's long multi-statement migration session. Outside production (manual/local) the runner falls back to `DATABASE_URL` for one-off runs. _Rejected:_ silently falling back to the pooled url on production (migrations would hang or half-apply — a worse failure than an explicit abort); overwriting the app's runtime `DATABASE_URL` with the direct url (the app wants pooling for many short serverless connections). _Why:_ direct-vs-pooled is a hard requirement of drizzle-kit migrate against Neon, and failing fast on a missing direct url is loud-at-deploy per architecture.md §14 (debuggability) and §2 (fail at the boundary).
- **DEC-MD10 — The GitHub Actions workflow is retained but DISABLED as a backup/reference.** The original workflow is kept at `.github/workflows/deploy.yml.disabled`; GitHub ignores files under `.github/workflows/` that don't end in `.yml`/`.yaml`, so it never runs. Re-enabling it means renaming it back to `deploy.yml` and pushing with `workflow` scope (fine-grained PAT with `workflow`, or push over SSH with a deploy key). The five other secrets from DEC-MD4 (`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `NEON_API_KEY`, `NEON_PROJECT_ID`) are relevant ONLY to this dormant workflow, not the live path. _Rejected:_ deleting the workflow outright (it's a useful reference implementation and a fast rollback path if the Vercel-native approach ever needs replacing). _Why:_ preserving a disabled reference costs one dormant file and keeps institutional memory of the alternative (architecture.md §13 — long-term maintainability).
- **DEC-MD11 — A stall fails closed: each migrate set is bounded by a 120s per-set timeout.** Each drizzle-kit `migrate` child is spawned with an explicit `MIGRATE_TIMEOUT_MS = 120_000` (120s) bound (`spawnSync(..., { timeout: MIGRATE_TIMEOUT_MS })`). On timeout the child is killed and the runner detects it (`result.error?.code === 'ETIMEDOUT'` or a non-null `result.signal`), logs a FATAL message naming the timed-out set (bookings/audit) and the bound, and `process.exit(1)` — so remaining sets are NOT applied and the whole build fails (nothing promoted). This is a fourth fail-closed mechanism, alongside the `vercel-build` `&&` chain (DEC-MD6), the production-only guard (DEC-MD7), and the fatal-missing-direct-url pre-flight check (DEC-MD9). _Rejected:_ no timeout / rely on the outer Vercel build timeout (a stalled migrate would hang to the build's global limit and then die with no attribution to which set stalled — the opposite of loud-at-deploy); a best-effort/tolerant continue-on-timeout (a silently skipped set is exactly the drift this SPEC exists to prevent — same reasoning as DEC-MD3). _Why:_ the most likely stall is a bad connection target (a pooled url that pgbouncer transaction pooling hangs, a wrong host, a network black hole); bounding each set makes that failure fast and attributable rather than a mysterious build-timeout hang (architecture.md §11 — resilience/timeouts on every off-process call; §14 — debuggability, the 3am page).

## Acceptance Criteria

- Running `pnpm db:migrate:deploy` (or the runner directly) applies both the bookings and the audit migration sets and exits non-zero if either fails (fail-closed).
- On a production Vercel build (`VERCEL_ENV === 'production'`), `vercel-build` runs the migrate step before `next build`; if the migrate step fails, `next build` never runs and no deployment is produced.
- On a preview/development Vercel build, the migrate step SKIPS (exit 0) and does NOT touch the production database; the build proceeds.
- On a production Vercel build, a missing `NEON_DIRECT_DATABASE_URL` aborts the build fatally (no fallback to the pooled url).
- A data-incompatible migration (e.g. the DEC-P10 `quantity` CHECK tighten against a `quantity > 6` row) blocks the build rather than corrupting or partially migrating data.
- A stalled migrate set is bounded by a 120s per-set timeout: on expiry the child is killed, the runner logs a FATAL naming the timed-out set, and exits non-zero (fail-closed) so remaining sets are not applied and no deployment is produced (DEC-MD11).
- The single operator prerequisite for the live path — `NEON_DIRECT_DATABASE_URL` (Neon DIRECT/non-pooled) set as a Vercel **Production** env var — is documented. The five other GitHub secrets are documented as applying ONLY to the retained-but-disabled backup workflow.

## Tasks

- [x] T1 — Add `scripts/migrate-deploy.mjs` that runs both drizzle migration sets (bookings via `drizzle.config.ts`, audit via `drizzle.audit.config.ts`), fail-closed (non-zero exit on any error). (owner: infra) — later hardened with the production-only guard (DEC-MD7) and the direct-url-required-in-production fatal check (DEC-MD9).
- [x] T2 — Add the `db:migrate:deploy` script to `package.json` (manual/one-off runner). (owner: infra)
- [x] T3 — ~~Add `.github/workflows/deploy.yml` running the migrate step as a gating step before the Vercel production promote, and against a Neon branch on preview.~~ SUPERSEDED by the Vercel-native pivot: the workflow was authored, then **disabled** (renamed to `.github/workflows/deploy.yml.disabled`) and retained as a backup/reference only (DEC-MD10). (owner: infra)
- [x] T6 — Add the `vercel-build` script to `package.json` (`node scripts/migrate-deploy.mjs && next build`) so migrations run inside the Vercel build, fail-closed via `&&` (DEC-MD5, DEC-MD6). (owner: infra)
- [ ] T4 — Operator: set `NEON_DIRECT_DATABASE_URL` (Neon DIRECT/non-pooled url) as a Vercel **Production** environment variable — the single prerequisite for the live path (DEC-MD9). The five GitHub repo secrets from DEC-MD4 apply only to the disabled backup workflow. Guide-only for the AI (infra-commandments §4). (owner: operator)
- [ ] T5 — Architectural / infra review. (owner: auditor)

## Change Log

<!-- ADD / MOD / DEL prefix; appended by implementing agents as work lands. -->

### 2026-07-03 — migrate-on-deploy added (DEC-MD1..DEC-MD4)

- ADD `scripts/migrate-deploy.mjs` — runs BOTH drizzle migration sets (bookings via `drizzle.config.ts`, audit via `drizzle.audit.config.ts`), fail-closed: a failure in either set aborts with a non-zero exit (DEC-MD1). Migrations run over the Neon DIRECT (non-pooled) connection.
- ADD `.github/workflows/deploy.yml` — runs `db:migrate:deploy` as a gating step before the Vercel production promote; on preview deploys runs the same step against a Neon branch database so data-incompatible migrations are caught on the branch (DEC-MD2, DEC-MD3).
- MOD `package.json` — ADD script `db:migrate:deploy` → runs `scripts/migrate-deploy.mjs` (DEC-MD1).
- Prerequisite (operator, guide-only): set six repo secrets — `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `NEON_API_KEY`, `NEON_PROJECT_ID`, `NEON_DIRECT_DATABASE_URL` (DEC-MD4). Not committed, not in any image layer (infra-commandments §4/§5).
- First-deploy note: the bookings `quantity` CHECK tighten to `1..6` (reservation-pivot DEC-P10, migration `0001_bitter_magneto.sql`) is data-incompatible with any `quantity > 6` row. The operator runs `SELECT count(*) FROM bookings WHERE quantity > 6` against production before the first deploy; if `0`, it applies cleanly. If non-zero, the fail-closed migrate step blocks the deploy by design (DEC-MD3).

### 2026-07-03 — pivot to Vercel-native deploys (DEC-MD5..DEC-MD10; DEC-MD2/MD4 superseded)

- MOD deploy strategy — deploys are now **Vercel's native Git integration**, not GitHub Actions. The migrate step moved OUT of the CI workflow and INTO the Vercel build.
- DEL (disable) `.github/workflows/deploy.yml` → renamed to `.github/workflows/deploy.yml.disabled`. GitHub ignores non-`.yml`/`.yaml` files under `.github/workflows/`, so it no longer runs; kept as a backup/reference only. Re-enabling = rename back to `deploy.yml` + push with `workflow` scope (SSH/deploy key or a fine-grained PAT with `workflow`). (DEC-MD10)
- MOD `package.json` — ADD `vercel-build` → `node scripts/migrate-deploy.mjs && next build`. The `&&` makes migrations fail-closed inside the build: a failed migrate stops the build before `next build`, so no deployment is produced. (DEC-MD5, DEC-MD6)
- MOD `scripts/migrate-deploy.mjs` — hardened for the Vercel-native path:
  - Production-only guard: migrate iff `VERCEL === '1'` AND `VERCEL_ENV === 'production'`; preview/development (or unset `VERCEL_ENV`) SKIP and exit 0 so the build proceeds without touching any DB. Outside a Vercel build the guard is a no-op. (DEC-MD7)
  - No Neon-branch-per-PR automation anymore (that lived in the disabled workflow); previews are NOT auto-migrated by design. (DEC-MD8)
  - DIRECT url required on production builds: uses `NEON_DIRECT_DATABASE_URL` (Neon DIRECT, non-pooled) injected into `DATABASE_URL` for the child drizzle-kit processes only; the app's runtime `DATABASE_URL` stays the pooled url. A missing connection string aborts FATALLY (exit 1) — no fallback to the pooled url (pgbouncer transaction pooling breaks the multi-statement migrate session). Outside production it falls back to `DATABASE_URL` for manual runs. (DEC-MD9)
- MOD operator setup — the single prerequisite for the live path is now ONE Vercel **Production** env var: `NEON_DIRECT_DATABASE_URL` (Neon MAIN DIRECT/non-pooled url). The six GitHub repo secrets from DEC-MD4 now apply ONLY to the retained-but-disabled backup workflow. (DEC-MD4 superseded by DEC-MD9)
- MOD `scripts/migrate-deploy.mjs` — per-set fail-closed migrate timeout added (part of this hardening; DEC-MD11). A `MIGRATE_TIMEOUT_MS = 120_000` (120s) constant bounds each drizzle-kit `migrate` child (`spawnSync(..., { timeout: MIGRATE_TIMEOUT_MS })`). On timeout the child is killed and detected via `result.error?.code === 'ETIMEDOUT'` / `result.signal != null`; the runner logs a FATAL message naming the timed-out set (bookings/audit) and `process.exit(1)`, so remaining sets are NOT applied and the Vercel build fails (nothing promoted). A stall (e.g. the pooled url pgbouncer hangs, a wrong host, a network black hole) now fails fast instead of hanging to the outer build timeout with no attribution.
- Note: this re-sync reflects the shipped hardening. Fail-closed is delivered by four mechanisms: the `&&` chain in `vercel-build`, the production-only guard, the fatal-missing-direct-url pre-flight check, and the per-set 120s migrate timeout (DEC-MD11).

<!-- AUTO:WORKLOG — appended (never overwritten) by the auditor on every run -->
## Worklog

2026-07-03T00:00:00Z  auditor  engineering review  PASS with notes  hardening re-review: both prior WARN concerns (fatal-missing-direct-url, per-set timeout) resolved; no regression; 2 awareness notes

<!-- /AUTO:WORKLOG -->

<!-- AUTO:VERDICT — overwritten by the auditor on every run -->
## Verdict
**PASS with notes** · 2026-07-03T00:00:00Z

The hardening pass resolves both prior WARN concerns. A production Vercel build
with `NEON_DIRECT_DATABASE_URL` unset/empty now aborts fatally (exit 1) before
touching either migration set, with no silent fallback to the pooled
`DATABASE_URL` (which pgbouncer would hang) — DEC-MD9. Each `drizzle-kit migrate`
child is bounded by a 120s per-set timeout; on expiry the child is killed and
detected (`result.error?.code === 'ETIMEDOUT' || result.signal != null`), the
runner logs a FATAL naming the set, and exits 1 so remaining sets are not
applied — DEC-MD11. Every control-flow branch was traced and is fail-closed:
prod+missing-direct→exit1; prod+direct→migrate; preview/dev/unset→skip exit0;
non-Vercel→prefer-direct-else-DATABASE_URL, fatal iff both empty; set-1
fail→exit before set-2; timeout→exit1 naming the set. No connection-string value
is ever logged (architecture.md §2). The child-only `process.env.DATABASE_URL`
assignment runs in a separate build process and does not clobber the app's
runtime pooled url. Idempotency is intact — no bespoke state, drizzle-kit's
journal alone. The SPEC is now accurate to the shipped Vercel-native reality
(SPEC-drift note resolved). No regression, no dead code, no premature
abstraction introduced by the hardening.

Two notes are surfaced for awareness only (not blocking): the default-SIGTERM
timeout kill is robust because parent-side detection fires regardless of a
grandchild ignoring the signal; and `env: process.env` forwards the full build
environment to the child, which is required for `DATABASE_URL` and leaks nothing
via inherited stdio. Neither warrants a change.

The prior WARN is RESOLVED. Nothing blocks. No remediation needed.

<!-- /AUTO:VERDICT -->
