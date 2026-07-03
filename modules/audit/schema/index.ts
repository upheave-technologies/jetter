// =============================================================================
// Audit Module — Schema Public API
// =============================================================================
// This is the schema directory barrel — the single exception to the project's
// no-barrel rule, per archie-rules.md §1 and project-structure.md §5.
// Consumers (the database wiring + repository) import the table, the enum
// objects, the const-tuple vocabularies, and the types from here; nothing else
// re-exports.
//
// The module provisions its schema via generated drizzle-kit migrations (see the
// Minimal Change Report: drizzle.config.ts must be pointed at this barrel, or a
// combined schema surface, before `drizzle-kit generate` will emit this module's
// CREATE TYPE / CREATE TABLE / CREATE INDEX statements).
// =============================================================================

export { auditEvents } from './auditEvents';
export type { AuditEventRow, NewAuditEventRow } from './auditEvents';
export {
  AUDIT_ENTITY_TYPE,
  AUDIT_ACTION,
  auditEntityTypeEnum,
  auditActionEnum,
} from './enums';
export type { AuditEntityType, AuditAction } from './enums';
