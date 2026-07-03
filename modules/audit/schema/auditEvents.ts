// =============================================================================
// Audit Module — audit_events Table (PostgreSQL) — APPEND-ONLY, IMMUTABLE
// =============================================================================
// One immutable row per audited action on the platform. This is the record of
// record: reservation create/edit/cancel, maintenance create/edit/cancel,
// reconciliation apply, and (if cleanly wired) auth login_success/login_failure.
// See system/context/audit/features/audit-log/SPEC.md (DEC-AU1..DEC-AU8).
//
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ DELIBERATE, DOCUMENTED DEVIATION FROM archie-rules §3 AND §2.IX            │
// │                                                                             │
// │ This table has NO `deleted_at` and NO `updated_at`. That is intentional.   │
// │                                                                             │
// │ archie-rules §3 mandates a soft-delete `deleted_at` on every entity table, │
// │ and §2.IX mandates `updated_at`. An audit log is the deliberate exception  │
// │ (SPEC DEC-AU2): it is APPEND-ONLY and IMMUTABLE. A soft-delete column would │
// │ let an entry be hidden, and an update path would let history be rewritten —  │
// │ both defeat the entire purpose of an audit trail (architecture.md §2, the  │
// │ trust boundary: the log is the record of record and must be trustworthy).  │
// │                                                                             │
// │ Precedent: modules/bookings/schema/bookings.ts already carries a documented │
// │ §3 deviation (no soft-delete; status='cancelled' is terminal). This module │
// │ deviates further — no soft-delete AND no update column — for immutability.  │
// │                                                                             │
// │ Corrections are NOT updates: a correction is itself a NEW append-only event.│
// │ There is no repository update/delete method (DEC-AU2 / AC-4). Optional      │
// │ belt-and-suspenders DB-level hardening (REVOKE UPDATE/DELETE, or a trigger  │
// │ that RAISEs) is discussed in the Minimal Change Report; it is a human/archie │
// │ decision, not encoded here.                                                 │
// └───────────────────────────────────────────────────────────────────────────┘
//
// Design decisions:
//   - id is a cuid2 text PK generated at the repository layer via
//     `$defaultFn(() => createId())` from '@paralleldrive/cuid2' — the
//     archie-rules §2.V idiom, identical to how packages/@core/identity generates
//     its principal ids. This NEW module follows §2.V; it deliberately does NOT
//     copy bookings' legacy nanoid choice (SPEC DEC-AU3). NOTE: the cuid2 package
//     is not yet a declared dependency of this app — see the Minimal Change Report
//     §4 (a `pnpm add @paralleldrive/cuid2` prerequisite before this compiles).
//
//   - occurred_at is a `timestamptz` (archie-rules §2.V required timestamp shape),
//     NOT NULL, `defaultNow()`. It is the moment the audited action happened and
//     the sole time column: it DOUBLES AS created_at. For an append-only log the
//     row's creation instant and the event instant are the same moment (the event
//     is recorded synchronously right after the mutation), so a separate
//     created_at would be redundant duplicate data. We name the single column
//     `occurred_at` because that is the domain-meaningful name (DEC-AU3). This is
//     a conscious naming deviation from archie-rules §2.VII's `created_at`
//     convention, justified by domain clarity + the absence of an update lifecycle
//     that would make the created/updated distinction meaningful. (See Report §3.)
//
//   - entity_type / action are real Postgres pgEnums (audit_entity_type /
//     audit_action from ./enums) — structured controlled vocabularies, not magic
//     strings (DEC-AU3, donnie-rules §6.9, archie-rules §2.V).
//
//   - entity_id is a plain `text` SOFT LINK to the affected bookings row — NO
//     foreign key (archie-rules §2.IV, cross-module Axiom of Data Sovereignty:
//     audit and bookings are separate modules; a hard FK would couple their
//     lifetimes and block independent purge). Nullable: batch reconciliations and
//     auth/system events have no single affected entity.
//
//   - actor is `text` NOT NULL default 'operator'. The platform has no user
//     accounts or principals (SPEC DEC-P1 / DEC-AG1 / DEC-AU4); there is one
//     shared operator behind one password gate. The column can carry richer
//     values later (initials, a name) with zero schema churn if the human decides
//     operators should self-identify — that upgrade is an OPEN PRODUCT QUESTION
//     flagged in the Minimal Change Report §7(a).
//
//   - summary is nullable `text` — a short human-readable Croatian description of
//     the event for the /audit viewer, optional.
//
//   - before / after are nullable `jsonb` entity snapshots (archie-rules §2.V:
//     jsonb, never json). before is null on create; after is null on a
//     hard-removal-style event. Shape is validated at the use-case layer, not the
//     DB (archie-rules §7). $type<Record<string, unknown>> gives compile-time
//     shape only.
//
//   - metadata is nullable `jsonb` — forensic actor context (ip, userAgent, and
//     anything else useful), captured at the server-action layer (nexus) and
//     threaded through the AuditWriter port.
//
// Index strategy (archie-rules §2.VI — index where queries hit, not where they
// might; the two reads below are the ONLY reads the SPEC describes for v1):
//   - idx_audit_events_occurred_at on (occurred_at DESC): the dominant read is
//     the paginated /audit viewer — "recent events, newest first" (DEC-AU8). A
//     descending index serves the ORDER BY occurred_at DESC + LIMIT/OFFSET (or
//     keyset) page directly without a sort step (archie-rules §2.VI: index every
//     ORDER BY column of a paginated list). The DESC is a physical property of
//     the index expression, not part of the name — the name follows the plain
//     §2.VII `idx_{table}_{columns}` convention (idx_audit_events_occurred_at).
//   - idx_audit_events_entity_id on (entity_id): the second read is "all events
//     for a given entity_id" — the forensic "what happened to THIS reservation?"
//     lookup. entity_id is the soft-link JOIN/WHERE target, so it is indexed
//     (archie-rules §2.VI: index every soft-link / WHERE target of a real read).
//   No index on entity_type or action: v1 has no filter-by-type/action read
//   (DEC-AU8 explicitly defers filtering); adding one is a one-line change +
//   `drizzle-kit generate` if a future filter read justifies it. No speculative
//   indexes (archie-rules §2.VI).
// =============================================================================

import { pgTable, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';

import { auditEntityTypeEnum, auditActionEnum } from './enums';

export const auditEvents = pgTable(
  'audit_events',
  {
    // cuid2 text PK (archie-rules §2.V). Generated at the repository layer.
    id: text('id')
      .primaryKey()
      .notNull()
      .$defaultFn(() => createId()),

    // The moment the audited action happened. Doubles as created_at for this
    // append-only log (see header). timestamptz, defaults to now().
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),

    // WHAT was acted on / WHAT happened — structured pgEnum vocabularies.
    entityType: auditEntityTypeEnum('entity_type').notNull(),
    action: auditActionEnum('action').notNull(),

    // Soft link to the affected bookings row — NO foreign key (archie-rules
    // §2.IV). Nullable: batch/auth/system events have no single entity.
    entityId: text('entity_id'),

    // The single shared operator (DEC-AU4). Upgradeable to richer values later.
    actor: text('actor').notNull().default('operator'),

    // Optional Croatian human-readable summary for the viewer.
    summary: text('summary'),

    // Entity snapshots. Shape validated in the use case, not the DB.
    before: jsonb('before').$type<Record<string, unknown>>(),
    after: jsonb('after').$type<Record<string, unknown>>(),

    // Forensic actor context: { ip?, userAgent?, ... } captured at the action layer.
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    // NOTE: intentionally NO updated_at (§2.IX deviation) and NO deleted_at
    // (§3 deviation) — this log is append-only and immutable. See header.
  },
  (table) => ({
    // Reverse-chronological paginated viewer read (DEC-AU8).
    occurredAtIdx: index('idx_audit_events_occurred_at').on(
      sql`${table.occurredAt} DESC`,
    ),
    // "All events for this entity" forensic lookup (soft-link WHERE target).
    entityIdIdx: index('idx_audit_events_entity_id').on(table.entityId),
  }),
);

export type AuditEventRow = typeof auditEvents.$inferSelect;
export type NewAuditEventRow = typeof auditEvents.$inferInsert;
