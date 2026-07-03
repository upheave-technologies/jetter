<!--
SPEC.md — working memory for one change-unit.

Lives at: system/context/bookings/features/sqlite-to-postgres/SPEC.md

This change-unit migrates the bookings module's storage engine from SQLite
(better-sqlite3) to PostgreSQL. It SUPERSEDES the storage decision of two
sibling SPECs:
  - ../booth-board/SPEC.md  — Decision #2 ("better-sqlite3 at data/board.db")
  - ../reservation-pivot/SPEC.md — its T1 "no migration pipeline / lazy
    CREATE TABLE IF NOT EXISTS / local DB reset required" SQLite assumptions.

Everything those SPECs decided ABOVE the storage layer (the sacred availability
engine, the reservation-pivot data model, the DDD layer cake, the no-auth /
no-tenant access model, polling sync) is carried forward UNCHANGED. This unit
touches only how rows are persisted — not what they mean.
-->

---
id: bookings-sqlite-to-postgres
slug: sqlite-to-postgres
module: bookings
type: feature
state: working
created: 2026-06-30
updated: 2026-06-30
---

<!-- AUTO:CARD — overwritten by the auditor on every run -->
## CARD — engineering review · 2026-06-30T17:20:00Z
**verdict** PASS with notes

**Changed files** 1  (delta re-audit; prior change-unit was 16 files)
Dockerfile  (builder-stage placeholder DATABASE_URL added before `RUN pnpm build`)

**Findings** 0 violations · 0 concerns · 4 notes  (3 carried from prior pass + 1 delta note)

### architecture — architecture.md
**Notes**
- Dockerfile:63  build placeholder DATABASE_URL is unmistakably fake (user/pw/host/db), never logged, never dialed (Pool lazy) — clean §2
- database.ts:59-65  pg Pool has no connectionTimeoutMillis / statement_timeout (§11) [carried]
- database.ts:48-73  one observability event on pool create; no error sink on conn fail (§14) [carried]

### infra-commandments — infra-commandments.md
**Notes**
- Dockerfile:63  placeholder is builder-stage ENV only; runner (L69+) never re-declares it, COPY --from=builder takes artifacts not env — no real secret in any image layer (§5); two-pipeline integrity intact, runtime URL stays in compose/Neon (§7). Optional: an `ARG` would be marginally cleaner than a hardcoded `ENV`.

### archie's rules — archie-rules.md
**Notes**
- migrations/0000_*.sql:1-2  CREATE TYPE enums not IF-NOT-EXISTS guarded; drizzle-standard, journal-gated (§5) [carried]

<!-- /AUTO:CARD -->

## Intent

The bookings module today persists to a single-file SQLite database (`better-sqlite3` at the gitignored `data/board.db`), created lazily on first boot via `CREATE TABLE IF NOT EXISTS` inside `infrastructure/database.ts`. That choice (booth-board Decision #2) served the original one-day favour-grade build well, but it has run out of road: there is no migration pipeline (the reservation-pivot SPEC's T1 explicitly flagged that the local DB cannot migrate in place and required a manual reset), the single-file engine is awkward to share across a real deploy, and the project now wants to ship to a cloud-hosted database in production.

This change-unit migrates the storage engine to **PostgreSQL**, fully replacing SQLite. In production the app connects to **Neon** (serverless Postgres) via a pooled connection string; in development it connects to a local Docker Postgres container. A single code path — `node-postgres` (`pg`) driven by one `DATABASE_URL` env var — serves both, because Neon's pooled endpoint speaks the standard Postgres wire protocol. The lazy bootstrap DDL is replaced by proper, reviewable **drizzle-kit migrations** applied on local stack-up and in the cloud deploy pipeline.

The swap is deliberately confined to the persistence boundary. Because the DDD layer cake keeps the domain pure and the repository maps `Date`↔`Date` at the edge, the entire `app/` surface, the availability engine, and the reservation-pivot data model are untouched. What becomes possible: a production-grade, reviewable, cloud-deployable database with a real schema lifecycle — and the project's `/infra-cloud-triage` tooling now has a Neon target to operate against.

## Scope

**In**

Schema + migration lifecycle (archie):
- `modules/bookings/schema/` — `pgTable` instead of `sqliteTable`; `status` and `kind` become `pgEnum` (archie-rules §7) instead of `text` + CHECK; timestamps become `timestamp({ withTimezone: true })` (timestamptz) instead of integer unix-ms.
- `drizzle.config.ts` — `dialect: 'postgresql'`, driven by `DATABASE_URL`.
- An initial drizzle-kit migration generated (`drizzle-kit generate` → versioned SQL) that matches the pgTable schema.

Infrastructure / driver (donnie):
- `infrastructure/database.ts` — a `pg` `Pool` singleton constructed from `DATABASE_URL`, wired through `drizzle-orm/node-postgres`. The lazy `CREATE TABLE IF NOT EXISTS` bootstrap DDL is REMOVED (migrations own schema now).
- `infrastructure/repositories/DrizzleBookingRepository.ts` — type-import swap only (SQLite → pg driver types). The repository's `Date`↔`Date` boundary mapping is unchanged.
- `package.json` — add `pg` + `@types/pg`; drop `better-sqlite3` + `@types/better-sqlite3`.

Local stack + cloud docs (infra):
- `infra/docker-compose.dev.yml` — add a `postgres` service (named `pgdata` volume, healthcheck, port via the kit's allocator), `board` `depends_on: postgres`, `DATABASE_URL` wired, a migrate step.
- `Dockerfile` — drop the `better-sqlite3` native-addon build.
- `infra/.env` + `infra/.env.example` — add `DATABASE_URL` (local Docker Postgres) and document the Neon pooled connection string.
- `infra/README.md` — rewrite the SQLite "favour-grade" storage narrative for Postgres + Neon.
- `infra/dev-seed.mjs` + `infra/dev-clear.mjs` — rewrite for `pg` (timestamptz inserts, not unix-ms integers).
- npm scripts — add `db:generate` / `db:migrate`; keep `seed` / `db:clear` / `docker:*`.

**Out**

- No `app/` changes — page.tsx, actions.ts, components, containers all stay as-is (DEC-PG6).
- No reintroduction of auth, Principal, tenant, or policy (carried from both siblings; `@core/auth`/`identity`/`iam` remain installed-but-unused).
- No change to the availability domain math (`domain/availability.ts` and siblings remain the sacred core — booth-board DEC-A / reservation-pivot DEC-P9).
- No change to the reservation-pivot data model semantics (`reserved | cancelled` × `reservation | maintenance`, density / slot-finder / reconciliation / utilization). Only the column TYPES change, not their meaning.
- No realtime transport — polling sync via `router.refresh()` (~2s) is unchanged.
- No SQLite fallback retained — this is a full replacement, not a dual-engine abstraction (DEC-PG1).
- No `@neondatabase/serverless` / edge-runtime adoption — rejected for now (DEC-PG3).
- Cloud Neon provisioning is GUIDE-ONLY — the infra agent documents the Neon setup and connection string; it never runs cloud CLIs (infra-commandments §4).
- The no-soft-delete deviation (no `deleted_at` column) carried forward from the booth-board / reservation-pivot SPECs is preserved, not reintroduced.

## Decisions

<!--
Recorded in the DEC-style of the sibling booth-board (DEC-A..DEC-F) and
reservation-pivot (DEC-P1..DEC-P9) SPECs. These six were chosen explicitly by
the human. DEC-PG2 supersedes booth-board Decision #2.
-->

1. **DEC-PG1 — Storage engine is PostgreSQL, fully replacing SQLite.** No SQLite fallback is retained; no dual-engine abstraction is introduced. The gitignored local `data/board.db` is abandoned. **Rejected:** a runtime-switchable storage abstraction (premature generality for a single deploy target — architecture.md §9 / §12; the repository interface is already the abstraction). **Why:** the project is moving to a cloud-hosted database; keeping a SQLite path alive would be two code paths to maintain for zero benefit. **Supersedes** booth-board Decision #2 ("better-sqlite3 at `data/board.db`") and the reservation-pivot's SQLite assumptions.

2. **DEC-PG2 — Cloud provider is Neon (serverless Postgres).** Production connects via a pooled Neon connection string in `DATABASE_URL`. This pairs with the project's `/infra-cloud-triage` tooling (the default Nucleus cloud deploy surface). **Rejected:** a self-hosted VPS Postgres (more operational surface than a favour-grade-derived app warrants; `/infra-cloud-triage` already targets Vercel + Neon); managed RDS/Cloud SQL (heavier, no advantage here). **Why:** Neon is serverless, branch-friendly, and already first-class in the project's infra triage tooling.

3. **DEC-PG3 — Driver is `node-postgres` (`pg`) via `drizzle-orm/node-postgres`, one `DATABASE_URL` for both environments.** A single code path serves local Docker Postgres and Neon, because Neon's pooled endpoint speaks the standard Postgres wire protocol. **Rejected:** `@neondatabase/serverless` (only needed for the edge runtime; the app runs Node-runtime `force-dynamic` server components, so `pg` is portable and sufficient — a future edge move is a small localized swap in `database.ts`); `postgres` (postgres.js) (`pg` is the most broadly documented and matches Nucleus conventions). **Why:** one driver, one connection string, maximum portability, minimum surface.

4. **DEC-PG4 — Schema lifecycle is drizzle-kit migrations.** `drizzle-kit generate` produces versioned SQL; `drizzle-kit migrate` applies it on local stack-up and in the cloud deploy pipeline. This REPLACES the lazy `CREATE TABLE IF NOT EXISTS` bootstrap in `infrastructure/database.ts`. **Rejected:** keeping lazy bootstrap DDL against Postgres (a DDL-on-every-cold-start race against a shared cloud database — unsafe; the reservation-pivot already documented the "no migration pipeline" pain). **Why:** proper, reviewable, archie-rules §5 compliant, safe against cloud Postgres, and it honors infra-commandments §7 (the two-pipeline model — code pipeline vs schema pipeline).

5. **DEC-PG5 — Postgres-native column types; the domain boundary is untouched.** `status` / `kind` become `pgEnum` (archie-rules §7) instead of `text` + CHECK; timestamps become `timestamp({ withTimezone: true })` (timestamptz) instead of integer unix-ms. The repository's `Date`↔`Date` mapping at the boundary is unchanged, so the domain layer never learns the storage type changed. The no-soft-delete deviation (no `deleted_at` column) is carried forward — documented, not reintroduced. **Rejected:** keeping `text` + CHECK to minimize diff (Postgres enums are the idiomatic, archie-rules §7-mandated representation; integer unix-ms throws away timezone-awareness Postgres gives for free). **Why:** use the database's native types; keep the type change invisible above the repository boundary.

6. **DEC-PG6 — The DDD layer cake means `app/` needs ZERO changes.** The swap is confined to `schema/` (archie), `infrastructure/` (donnie), and `infra/` (infra agent). page.tsx, actions.ts, components, and containers are not touched, because they depend only on the use-case + domain-type surface, never on the storage engine. **Why:** this is the layer cake paying off exactly as designed — the persistence boundary is the only thing that changes, and it is the only thing the layer cake lets change without rippling upward. Tagged against `architecture.md §1` (encapsulation) and `ddd-architecture.md §1` (layer cake).

## Acceptance Criteria

<!--
Plain-English observable checks. Documentation of intent — the auditor does not
run them. AC-1 anchors the "no SQLite left behind" claim; AC-5 anchors the
single-code-path portability claim (DEC-PG3).
-->

- [ ] **AC-1 — App boots on local Postgres, zero SQLite in compiled code.** The app boots and serves the board against a local Docker Postgres, with no SQLite references (`better-sqlite3`, `sqliteTable`, `data/board.db`) remaining anywhere in the compiled application code.
- [ ] **AC-2 — Clean initial migration.** `drizzle-kit generate` produces a clean initial migration whose SQL matches the `pgTable` schema (pgEnum for status/kind, timestamptz for the timestamps).
- [ ] **AC-3 — Stack-up applies migrations and renders.** `pnpm docker:up` (or `stack up`) brings up Postgres + the board, the migrations apply, and the board renders.
- [ ] **AC-4 — Seed populates local Postgres.** `pnpm seed` populates the local Postgres with the packed-day fixture (timestamptz inserts, concurrency ≤ fleet), and the board reflects it.
- [ ] **AC-5 — One code path serves Neon.** A `DATABASE_URL` pointed at a Neon pooled connection string works with no code changes — the same `pg` path that serves local Docker Postgres.
- [ ] **AC-6 — Architecturally clean.** The auditor passes the change-unit: the storage swap stays inside `schema/` + `infrastructure/` + `infra/`, the domain and `app/` layers are untouched, and the migration is archie-rules §5 / §7 compliant.

## Tasks

<!--
Ordered by layer dependency so schema + migration drive the diff downstream:
schema → driver/infrastructure → local stack + cloud docs → audit.
-->

- [ ] **T1 — Schema → Postgres + migration** (owner: archie)
  Convert `modules/bookings/schema/` from SQLite to Postgres. Produce a **Minimal Change Report** for user approval before any migration runs.
  - `pgTable` instead of `sqliteTable`; `status` and `kind` → `pgEnum` (archie-rules §7), replacing `text` + CHECK.
  - Timestamps (`startTime`, `endTime`, `createdAt`, `updatedAt`) → `timestamp({ withTimezone: true })` (timestamptz), replacing integer unix-ms.
  - Preserve the day-range read index (`start_time`, and `kind`/`status` as the reservation-pivot established).
  - Preserve the no-soft-delete deviation (no `deleted_at` column) — documented, not reintroduced (DEC-PG5).
  - `drizzle.config.ts` → `dialect: 'postgresql'`, driven by `DATABASE_URL` (DEC-PG4).
  - Run `drizzle-kit generate` to produce the initial versioned migration; confirm the SQL matches the schema (AC-2). (DEC-PG4, DEC-PG5)

- [ ] **T2 — Driver swap + repository type swap** (owner: donnie)
  - `infrastructure/database.ts` — replace the `better-sqlite3` instance with a `pg` `Pool` singleton constructed from `DATABASE_URL`, wired through `drizzle-orm/node-postgres`. **Remove** the lazy `CREATE TABLE IF NOT EXISTS` bootstrap DDL — migrations own schema now (DEC-PG4).
  - `infrastructure/repositories/DrizzleBookingRepository.ts` — type-import swap only (SQLite driver types → pg driver types). The `Date`↔`Date` boundary mapping (and every other behavior) is unchanged (DEC-PG5).
  - `package.json` — add `pg` + `@types/pg`; drop `better-sqlite3` + `@types/better-sqlite3`.
  - Confirm `tsc --noEmit` is clean and no domain/`app/` file required a change (DEC-PG6).

- [ ] **T3 — Local stack + cloud connection docs** (owner: infra)
  - `infra/docker-compose.dev.yml` — add a `postgres` service: named `pgdata` volume, healthcheck, port via the kit's allocator (no hardcoded port — infra-commandments §8). `board` gets `depends_on: postgres`; `DATABASE_URL` wired into the board service; add a migrate step (`drizzle-kit migrate`) before/at board start (DEC-PG4).
  - `Dockerfile` — drop the `better-sqlite3` native-addon build step.
  - `infra/.env` + `infra/.env.example` — add `DATABASE_URL` (local Docker Postgres) and document the Neon pooled connection string format (DEC-PG2, DEC-PG3).
  - `infra/README.md` — rewrite the SQLite "favour-grade" storage narrative for Postgres + Neon.
  - `infra/dev-seed.mjs` + `infra/dev-clear.mjs` — rewrite for `pg`: timestamptz inserts (not unix-ms integers), packed-day fixture preserved (idempotent, concurrency ≤ fleet).
  - npm scripts — add `db:generate` (`drizzle-kit generate`) / `db:migrate` (`drizzle-kit migrate`); keep `seed` / `db:clear` / `docker:*`.
  - Neon cloud connection is **guide-only** — document the steps; never run cloud CLIs (infra-commandments §4). (DEC-PG2, DEC-PG3, DEC-PG4)

- [ ] **T4 — Architectural review** (owner: auditor)
  Full pass over the change-unit against `architecture.md`, `project-structure.md`, `ddd-architecture.md`, plus `archie-rules.md` and `donnie-rules.md`. Specific checks:
  - Storage swap stays inside `schema/` + `infrastructure/` + `infra/`; the domain layer and `app/` surface are untouched (DEC-PG6, ddd-architecture §1).
  - No SQLite left behind: zero `better-sqlite3` / `sqliteTable` / `data/board.db` references in compiled code (AC-1).
  - pgEnum used for status/kind (archie-rules §7); timestamptz for timestamps (DEC-PG5).
  - Lazy bootstrap DDL removed; migrations are the schema lifecycle (archie-rules §5, DEC-PG4).
  - The repository `Date`↔`Date` boundary mapping is preserved (the domain never sees the storage-type change).
  - No `@neondatabase/serverless` / edge adoption smuggled in; one `pg` + `DATABASE_URL` code path (DEC-PG3).

## Change Log

<!-- ADD / MOD / DEL prefix; appended by implementing agents as work lands. -->

### 2026-06-30

**archie** — schema → Postgres + initial migration (T1)
- MOD `modules/bookings/schema/enums.ts` — added `pgEnum` objects `bookingStatusEnum` (`booking_status`) + `bookingKindEnum` (`booking_kind`); kept the `BOOKING_STATUS` / `BOOKING_KIND` tuples + TS types.
- MOD `modules/bookings/schema/bookings.ts` — `sqliteTable` → `pgTable`; timestamps → `timestamptz` (start/end/created/updated; created + updated `DEFAULT now()`); status/kind → pgEnum; quantity 1–8 and end>start as pg-core `check()`; removed the raw `bookingsCreateTableSql` / `bookingsCreateIndexSql` exports.
- MOD `modules/bookings/schema/index.ts` — export the pgEnums; drop the two removed SQL-fragment exports.
- MOD `drizzle.config.ts` — `dialect: 'postgresql'`, `dbCredentials.url = DATABASE_URL`, `out: './modules/bookings/schema/migrations'`.
- ADD `modules/bookings/schema/migrations/0000_blushing_multiple_man.sql` (+ `meta/_journal.json`, `meta/0000_snapshot.json`) — initial generated migration: `CREATE TYPE` ×2, `CREATE TABLE bookings` (timestamptz + CHECKs), `idx_bookings_start_time`, 0 FKs.

**donnie** — driver swap + repository type swap (T2)
- MOD `modules/bookings/infrastructure/database.ts` — replaced `better-sqlite3` with a `pg` `Pool` + `drizzle-orm/node-postgres` lazy singleton reading `DATABASE_URL` (max 10, idleTimeout); throws a clear error if `DATABASE_URL` is unset; SSL delegated to the connection string; removed the bootstrap `db.run()` calls and SQLite pragmas.
- MOD `modules/bookings/infrastructure/repositories/DrizzleBookingRepository.ts` — comment-only (header now node-postgres + timestamptz→Date); no logic change (already Postgres-compatible).
- MOD `package.json` — deps: +`pg`, −`better-sqlite3`; devDeps: +`@types/pg`, −`@types/better-sqlite3`; scripts: +`db:generate`, +`db:migrate`.

**infra** — local stack + cloud connection docs (T3)
- MOD `infra/docker-compose.dev.yml` — added a `postgres` service (`postgres:16-alpine`, named `pgdata` volume, `pg_isready` healthcheck, `${STACK_PORT_DB:-5432}:5432`, dashboard labels); `board` rewired with `depends_on: postgres (service_healthy)` + in-network `DATABASE_URL=postgres://jet:jet@postgres:5432/jet`; removed `BOOKINGS_DB_PATH` + the `../data` bind-mount; declared top-level `volumes.pgdata`.
- MOD `Dockerfile` — removed the `better-sqlite3` native-addon build (python3/make/g++) + explicit module copy + `mkdir /app/data`; ADDED a builder-stage-only placeholder `DATABASE_URL` before `RUN pnpm build` (the `pg` Pool constructs lazily at next-build page-data collection; `force-dynamic` prevents queries; real URL injected at runtime; placeholder never reaches the runner stage).
- MOD `infra/.env.example` + `infra/.env` — Postgres local defaults (jet/jet/jet), `STACK_PORT_DB`, host-facing `DATABASE_URL` (localhost:mapped-port), commented Neon production example (pooled host + `sslmode=require`, guide-only).
- MOD `infra/dev-seed.mjs` + `infra/dev-clear.mjs` — persistence swapped `better-sqlite3` → `pg`; timestamptz inserts (Date, not unix-ms); `to_regclass` table check; pg transaction; generation logic unchanged.
- MOD `infra/README.md` — Postgres + Neon rewrite: two-service diagram, migrate-from-host flow, pgdata-volume reset, `stack psql` inspect, guide-only Production:Neon runbook.
- MOD `infra/_kit/manifest.yaml` — db service block (postgres) for `stack psql`; `deploy_target: cloud`.

## Verification

<!--
LIVE results — this workspace is outside the auditor's scope; these were run by
the orchestrator against the local Docker stack. The auditor's own architectural
verdict lives in the AUTO:* blocks below.
-->

Local Docker stack verified end-to-end on **2026-06-30**.

- **Postgres up.** `docker compose up postgres` → `jet-postgres` healthy on host port **5706** (allocator-assigned; host 5432 was already taken by an unrelated local Postgres).
- **Migration applied (AC-2, AC-3).** `pnpm db:migrate` (host `DATABASE_URL=postgres://jet:jet@localhost:5706/jet`) applied `0000_blushing_multiple_man.sql`: `bookings` table present; `booking_status` (reserved, cancelled) + `booking_kind` (reservation, maintenance) enum types created; `idx_bookings_start_time` + both CHECK constraints (quantity 1–8, end>start) present; timestamptz columns confirmed.
- **Seed loaded (AC-4).** `pnpm seed` loaded 40 rows (38 reservations + 2 maintenance); peak concurrency 8/8 ≤ fleet; timestamptz values correct in Europe/Zagreb.
- **Board serves off Postgres (AC-1, AC-3).** Board container (`jet-board:dev`) built clean after the Dockerfile placeholder fix; verified serving HTTP 200 off Postgres on host port **4426** (the allocator's 4425 was occupied by a stale 4-day host next-server from the prior pivot verification); `pool_created`, no DB errors in logs.
- **Auditor (AC-6).** PASS with notes (initial 16-file change-unit) + PASS with notes (Dockerfile delta). Non-blocking notes deferred: `pg` Pool lacks `connectionTimeoutMillis` / `statement_timeout` (architecture §11) and an error sink on connection failure (§14); generated `CREATE TYPE` not `IF NOT EXISTS`-guarded (drizzle-standard, journal-gated).

<!-- AUTO:WORKLOG — appended (never overwritten) by the auditor on every run -->
## Worklog

2026-06-30T15:46:00Z  auditor  engineering review  PASS with notes  SQLite→Postgres swap confined to schema/+infrastructure/+infra/; layer cake intact, app/ + use cases untouched, zero SQLite imports remain, migration faithful to pgTable. 3 notes (pg pool timeout, conn-fail sink, enum-DDL idempotency).
2026-06-30T17:20:00Z  auditor  engineering review (delta)  PASS with notes  Dockerfile builder-stage placeholder DATABASE_URL added to clear the `next build` collect-page-data env guard. Placeholder unmistakably fake, builder-stage only (runner never re-declares; COPY --from=builder takes artifacts not env), no real secret in any image layer (infra-cmd §5), runtime URL still from compose/Neon (§7). No other change. 1 optional note (ARG would be cleaner than hardcoded ENV).

<!-- /AUTO:WORKLOG -->

<!-- AUTO:VERDICT — overwritten by the auditor on every run -->
## Verdict
**PASS with notes** · 2026-06-30T17:20:00Z

Delta re-audit of one file: `Dockerfile`. The change adds a single builder-stage `ENV DATABASE_URL` placeholder (line 63) immediately before `RUN pnpm build`, plus an accurate explanatory comment block (lines 56-62). It resolves a real build failure: `next build`'s collect-page-data phase imports the bookings module graph, which constructs the `pg` Pool at module load via the pre-wired repository singleton, and `database.ts` throws when `DATABASE_URL` is unset. The Pool is lazy (no connection at construction) and `app/page.tsx` is `force-dynamic` (no query at build), so the placeholder is never dialed. The minimal correct fix is exactly this.

All four delta checks pass. (1) The placeholder is unmistakably fake — `placeholder-build-only` / `not-a-real-secret` / loopback `127.0.0.1` / `build_time_placeholder_db` — carries no real credential or host, and is never logged by value (architecture §2 clean). (2) It lives in the `builder` stage only; the `runner` stage (line 69+) sets its own `NODE_ENV`/`PORT`/`HOSTNAME` block and never re-declares `DATABASE_URL`, and the three `COPY --from=builder` lines copy build artifacts (`.next/standalone`, `.next/static`, `public`) not the builder environment — ENV does not cross multi-stage boundaries, so the placeholder cannot reach the runtime image (infra-commandments §5, multi-stage isolation). (3) No other change snuck in — the install/copy/build sequence, non-root runner hardening, healthcheck, and CMD are identical to the prior pass. (4) The runtime `DATABASE_URL` still comes from compose (in-network URL, dev) and Neon (prod) — the image carries no real connection string, preserving the two-pipeline model (infra-commandments §7). The placeholder being a fake value baked into the discarded builder layer means §5's "no real secret in an image layer" holds even for the builder.

Four notes, none blocking. Three are carried unchanged from the prior pass and live in files not touched by this delta: the `pg` Pool's missing `connectionTimeoutMillis`/`statement_timeout` (architecture §11) and the missing conn-fail error sink (§14) in `modules/bookings/infrastructure/database.ts`, and the drizzle-generated non-`IF NOT EXISTS` `CREATE TYPE` (archie-rules §5, journal-gated, informational). One is new and optional: the build placeholder is a hardcoded `ENV` rather than a throwaway `ARG`; an `ARG DATABASE_URL` consumed only for the build step would keep the value out of even the builder image-config metadata — a stylistic nicety, fully neutralized already by the fake value plus the multi-stage discard, so no action recommended. The delta is a clean improvement to the change-unit and ships as-is.

<!-- /AUTO:VERDICT -->
