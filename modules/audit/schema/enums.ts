// =============================================================================
// Audit Module — Controlled Vocabularies (PostgreSQL enums + TS unions)
// =============================================================================
// The audit log records structured events, not free-text strings (SPEC DEC-AU3).
// Two controlled vocabularies discriminate every event:
//   - entityType : WHAT was acted on (reservation / maintenance / ... / system)
//   - action     : WHAT happened to it (create / edit / cancel / ... )
//
// Both follow the house const-tuple → pgEnum + TS-union pattern established in
// modules/bookings/schema/enums.ts. The const tuple is the single source of
// truth; both the DB enum value list AND the TypeScript union derive from it, so
// adding a value touches exactly one tuple here and nothing else drifts.
//
// --- entityType : pgEnum (closed, structural vocabulary) ---
// entityType is a small, closed, structural set — it names the KINDS of things
// the platform can act on. It changes rarely (only when a genuinely new domain
// is added), and each value maps to a real module. A pgEnum is the right fit:
// the DB rejects any value outside the set, and the vocabulary is stable enough
// that a migration-per-value is not a burden. (archie-rules §2.V: Enums →
// pgEnum; donnie-rules §6.9: no magic-string vocabularies.)
//   reservation    → a revenue-bearing bookings row (kind = 'reservation')
//   maintenance    → a capacity-blocking bookings row (kind = 'maintenance')
//   reconciliation → a batch action shifting multiple future reservations
//   auth           → a login event (login_success / login_failure)
//   system         → a platform/system-level event with no single entity
//
// --- action : pgEnum (closed, cross-entity verb vocabulary) ---
// DECISION: action is a pgEnum, not free text. Rationale in the Minimal Change
// Report §5. In short: the action set is a small controlled vocabulary that
// donnie-rules §6.9 says must NOT be a magic string; a pgEnum gives DB-level
// rejection of typos and exact parity with the bookings enum idiom. The set
// spans entity types (a create applies to reservation/maintenance; login_* to
// auth) — this is expected: one flat verb vocabulary keys the whole log, and the
// (entityType, action) PAIR carries the meaning. Growth cost is one tuple line +
// one `ALTER TYPE ... ADD VALUE` migration (additive, non-breaking, zero-downtime
// — Postgres appends enum values online). That cost is acceptable for a set this
// stable; the type-safety and queryability win outweighs text's loose flexibility
// for a log whose entire value is being trustworthy and structured (DEC-AU3).
//   create        → an entity was brought into existence
//   edit          → an existing entity's fields were changed
//   cancel        → an entity was voided (bookings status → 'cancelled')
//   apply         → a reconciliation proposal was applied (batch shift)
//   login_success → an operator authenticated successfully
//   login_failure → an authentication attempt was rejected
// =============================================================================

import { pgEnum } from 'drizzle-orm/pg-core';

export const AUDIT_ENTITY_TYPE = [
  'reservation',
  'maintenance',
  'reconciliation',
  'auth',
  'system',
] as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPE)[number];

export const AUDIT_ACTION = [
  'create',
  'edit',
  'cancel',
  'apply',
  'login_success',
  'login_failure',
] as const;

export type AuditAction = (typeof AUDIT_ACTION)[number];

// Native Postgres enum types. The column definitions in `./auditEvents.ts`
// reference these; drizzle-kit emits `CREATE TYPE audit_entity_type AS ENUM (...)`
// and `CREATE TYPE audit_action AS ENUM (...)` in the generated migration.
// Derived from the tuples above so the DB enum, the TS union, and the runtime
// value list never drift.
export const auditEntityTypeEnum = pgEnum('audit_entity_type', AUDIT_ENTITY_TYPE);

export const auditActionEnum = pgEnum('audit_action', AUDIT_ACTION);
