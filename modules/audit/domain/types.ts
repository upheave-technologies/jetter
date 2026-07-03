// =============================================================================
// Audit Module — Public Domain Types
// =============================================================================
// The audit log is a platform-wide, append-only record of every action.
// See system/context/audit/features/audit-log/SPEC.md (DEC-AU1..DEC-AU8).
//
// Domain is pure: no schema imports, no ORM types, no I/O.
// AuditEntityType and AuditAction mirror the schema enum const-tuples but are
// defined independently here — the domain must NOT import schema files
// (ddd-architecture §1 layer cake). The repository maps between them.
// =============================================================================

// ---------------------------------------------------------------------------
// Controlled vocabularies (mirrors schema/enums.ts tuples — kept in sync by
// convention; the repository is the only layer that touches both sides)
// ---------------------------------------------------------------------------

/**
 * WHAT was acted on. Mirrors AUDIT_ENTITY_TYPE in schema/enums.ts.
 * Define the union here; never import from schema in domain code.
 */
export type AuditEntityType =
  | 'reservation'
  | 'maintenance'
  | 'reconciliation'
  | 'auth'
  | 'system';

/**
 * WHAT happened to it. Mirrors AUDIT_ACTION in schema/enums.ts.
 * Define the union here; never import from schema in domain code.
 */
export type AuditAction =
  | 'create'
  | 'edit'
  | 'cancel'
  | 'apply'
  | 'login_success'
  | 'login_failure';

// ---------------------------------------------------------------------------
// Core entity
// ---------------------------------------------------------------------------

/**
 * Domain representation of an audit_events row.
 * Append-only and immutable — no updatedAt, no deletedAt (DEC-AU2).
 */
export type AuditEvent = {
  id: string;
  occurredAt: Date;
  entityType: AuditEntityType;
  action: AuditAction;
  entityId: string | null;
  actor: string;
  summary: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
};

// ---------------------------------------------------------------------------
// Request-scoped forensic context
// ---------------------------------------------------------------------------

/**
 * Forensic request context threaded from the server action layer (nexus)
 * down through the AuditWriter port into the audit event metadata (DEC-AU4).
 * actor defaults to 'operator' when absent — the single shared operator.
 */
export type AuditContext = {
  actor?: string;
  ip?: string;
  userAgent?: string;
};

// ---------------------------------------------------------------------------
// Input for use cases
// ---------------------------------------------------------------------------

/**
 * Input to the recordAuditEvent use case.
 * Caller provides entityType + action (required) and all optional fields.
 * before/after are unknown to allow passing arbitrary domain snapshots.
 */
export type RecordAuditEventInput = {
  entityType: AuditEntityType;
  action: AuditAction;
  entityId?: string | null;
  actor?: string;
  summary?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown> | null;
  context?: AuditContext;
};

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/**
 * Module-scoped error shape for the audit module.
 * Use cases return Result<T, AuditError>.
 */
export type AuditError = {
  code: 'VALIDATION_ERROR' | 'SERVICE_ERROR';
  message: string;
  details?: unknown;
};
