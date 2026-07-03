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

_no audit run yet_

<!-- /AUTO:CARD -->

## Intent

The project now ships to Vercel + Neon (serverless Postgres) and its schema lifecycle is drizzle-kit migrations (sqlite-to-postgres DEC-PG4), not lazy bootstrap DDL. There are two independent migration sets: the bookings module (driven by `drizzle.config.ts`) and the audit module (driven by its own `drizzle.audit.config.ts`, kept separate to preserve module isolation). Until now nothing guaranteed those migrations were applied to the production database before new application code that depends on them went live — a classic deploy hazard where the code expects a column or constraint the database does not yet have.

This change-unit adds a **migrate-on-deploy** step: a script that applies **both** drizzle migration sets, run as a **gating** step in the deploy pipeline before the Vercel production promote (and against a Neon branch database on preview deploys). The step is **fail-closed** — if a migration fails to apply (including a data-incompatible migration such as tightening a CHECK constraint against rows that violate it), the deploy is blocked rather than allowed to ship code against an unmigrated or half-migrated database. This makes schema/code drift impossible to ship silently and makes data-incompatibility cheap to discover at deploy time instead of at 3am in production.

## Scope

**In**
- A migration runner script that applies BOTH drizzle migration sets (bookings via `drizzle.config.ts`, audit via `drizzle.audit.config.ts`), fail-closed on any error.
- A `package.json` script to invoke it.
- A GitHub Actions deploy workflow that runs migrations as a gating step before the Vercel production promote, and against a Neon branch DB on preview.
- Documentation of the repo secrets the operator must set for the workflow to function.

**Out**
- No change to the schemas themselves — this change-unit runs migrations; it does not author them (archie owns schema; the migrations already exist per sqlite-to-postgres and audit-log).
- No change to application behavior, the availability engine, or the audit recording path.
- No cloud CLI execution by any AI agent — Neon/Vercel provisioning and secret setting are operator actions (infra-commandments §4). The workflow runs in CI with operator-provisioned secrets.
- No rollback automation — fail-closed means the deploy halts; recovery is an operator action.
- No merging of the two drizzle configs into one — they stay separate to preserve module isolation (the audit module owns its own migrations dir).

## Decisions

- **DEC-MD1 — One runner applies BOTH migration sets, fail-closed.** A single script (`scripts/migrate-deploy.mjs`) runs the bookings migration set (`drizzle.config.ts`) and the audit migration set (`drizzle.audit.config.ts`) in sequence; any failure aborts with a non-zero exit so the caller (CI) treats it as a hard stop. _Rejected:_ two separate deploy steps that could partially succeed (a half-migrated database is worse than a blocked deploy); a single merged drizzle config (would write both modules' DDL into one journal, clobbering the audit module's isolation — see the audit-log Change Log, archie's note on why a separate config exists). _Why:_ both databases must be current together, and fail-closed is the only safe posture when application code is about to depend on the new schema (architecture.md §15 — small reversible steps; a blocked deploy is fully reversible, a shipped drift is not).
- **DEC-MD2 — Migrations gate the Vercel production promote; preview runs against a Neon branch.** The GitHub Actions workflow (`.github/workflows/deploy.yml`) runs `db:migrate:deploy` as a required step before promoting the Vercel production deployment. On preview deploys the same step runs against a Neon branch database, so a data-incompatible migration is caught on the branch before it can reach production. _Rejected:_ running migrations from the app at boot / first request against the shared cloud DB (a DDL-on-cold-start race against a shared database — exactly the hazard sqlite-to-postgres DEC-PG4 rejected); applying migrations manually before each deploy (unreliable, forgettable, and invisible to the pipeline). _Why:_ the deploy pipeline is the right place to guarantee the ordering (schema before code), and Neon's branch databases make preview a safe rehearsal (infra-commandments §7 — the code and schema pipelines converge safely here).
- **DEC-MD3 — Fail-closed is a feature, not a bug, for data-incompatible migrations.** A migration that cannot apply because existing data violates a new constraint (e.g. the bookings `quantity` CHECK tightened from `1..8` to `1..6` per reservation-pivot DEC-P10, against a row where `quantity > 6`) will fail the migrate step and block the deploy by design. The operator resolves the offending data first (for the DEC-P10 case: run `SELECT count(*) FROM bookings WHERE quantity > 6` against production before the first deploy; if `0`, it applies cleanly). _Rejected:_ making the runner tolerant / best-effort (a silently skipped migration is the drift this whole change-unit exists to prevent). _Why:_ the entire value is that drift and data-incompatibility surface at deploy time, loudly, before code ships (architecture.md §2 domain/schema trust boundary; §16 make-the-implicit-explicit).
- **DEC-MD4 — The workflow requires six operator-set repo secrets.** The deploy workflow needs, and the operator must set: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (Vercel promote), and `NEON_API_KEY`, `NEON_PROJECT_ID`, `NEON_DIRECT_DATABASE_URL` (Neon branch + the direct — non-pooled — connection the migrator uses). Migrations run over the DIRECT connection string, not the pooled one. _Rejected:_ baking any of these into the repo or an image (infra-commandments §4/§5 — secrets are operator-set, never committed, never in an image layer). _Why:_ the two-pipeline model (infra-commandments §7) — code flows through CI, secrets are operator-provisioned; CI reads them from repo secrets at run time.

## Acceptance Criteria

- Running `pnpm db:migrate:deploy` applies both the bookings and the audit migration sets and exits non-zero if either fails (fail-closed).
- The GitHub Actions deploy workflow runs the migrate step and blocks the Vercel production promote when the migrate step fails.
- On a preview deploy the migrate step runs against a Neon branch database, so a data-incompatible migration is caught before production.
- A data-incompatible migration (e.g. the DEC-P10 `quantity` CHECK tighten against a `quantity > 6` row) blocks the deploy rather than corrupting or partially migrating data.
- The six repo secrets (VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID, NEON_API_KEY, NEON_PROJECT_ID, NEON_DIRECT_DATABASE_URL) are documented as prerequisites the operator must set.

## Tasks

- [x] T1 — Add `scripts/migrate-deploy.mjs` that runs both drizzle migration sets (bookings via `drizzle.config.ts`, audit via `drizzle.audit.config.ts`), fail-closed (non-zero exit on any error). (owner: infra)
- [x] T2 — Add the `db:migrate:deploy` script to `package.json`. (owner: infra)
- [x] T3 — Add `.github/workflows/deploy.yml` running the migrate step as a gating step before the Vercel production promote, and against a Neon branch on preview. (owner: infra)
- [ ] T4 — Operator: set the six repo secrets (VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID, NEON_API_KEY, NEON_PROJECT_ID, NEON_DIRECT_DATABASE_URL). Guide-only for the AI (infra-commandments §4). (owner: operator)
- [ ] T5 — Architectural / infra review. (owner: auditor)

## Change Log

<!-- ADD / MOD / DEL prefix; appended by implementing agents as work lands. -->

### 2026-07-03 — migrate-on-deploy added (DEC-MD1..DEC-MD4)

- ADD `scripts/migrate-deploy.mjs` — runs BOTH drizzle migration sets (bookings via `drizzle.config.ts`, audit via `drizzle.audit.config.ts`), fail-closed: a failure in either set aborts with a non-zero exit (DEC-MD1). Migrations run over the Neon DIRECT (non-pooled) connection.
- ADD `.github/workflows/deploy.yml` — runs `db:migrate:deploy` as a gating step before the Vercel production promote; on preview deploys runs the same step against a Neon branch database so data-incompatible migrations are caught on the branch (DEC-MD2, DEC-MD3).
- MOD `package.json` — ADD script `db:migrate:deploy` → runs `scripts/migrate-deploy.mjs` (DEC-MD1).
- Prerequisite (operator, guide-only): set six repo secrets — `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `NEON_API_KEY`, `NEON_PROJECT_ID`, `NEON_DIRECT_DATABASE_URL` (DEC-MD4). Not committed, not in any image layer (infra-commandments §4/§5).
- First-deploy note: the bookings `quantity` CHECK tighten to `1..6` (reservation-pivot DEC-P10, migration `0001_bitter_magneto.sql`) is data-incompatible with any `quantity > 6` row. The operator runs `SELECT count(*) FROM bookings WHERE quantity > 6` against production before the first deploy; if `0`, it applies cleanly. If non-zero, the fail-closed migrate step blocks the deploy by design (DEC-MD3).

<!-- AUTO:WORKLOG — appended (never overwritten) by the auditor on every run -->
## Worklog

<!-- /AUTO:WORKLOG -->

<!-- AUTO:VERDICT — overwritten by the auditor on every run -->
## Verdict

_no audit run yet_

<!-- /AUTO:VERDICT -->
