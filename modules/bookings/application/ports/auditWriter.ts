// =============================================================================
// Bookings Module — AuditWriter Port
// =============================================================================
// Defines the port type used by all bookings mutation use cases to record
// audit events without hard-importing the audit module's internals.
//
// Isolation design (SPEC DEC-AU5, donnie-rules §6.4):
//   bookings → [this port] → [adapter] → audit module's public use case
//
// This port is defined in modules/bookings/application/ports/ (the bookings
// module's port layer). The adapter lives in infrastructure/adapters/.
// The audit module's internals are never imported from bookings/application/.
//
// AuditWriteInput uses AuditEntityType / AuditAction / AuditContext imported
// from the audit module's public domain types — this cross-module type import
// through the public surface is the ONLY allowed seam (donnie-rules §6.4):
//   modules/bookings → modules/audit/domain/types (public types only)
// =============================================================================

import type { AuditEntityType, AuditAction, AuditContext } from '@/modules/audit/domain/types';

export type { AuditEntityType, AuditAction, AuditContext };

export type AuditWriteInput = {
  entityType: AuditEntityType;
  action: AuditAction;
  entityId?: string | null;
  summary?: string;
  before?: unknown;
  after?: unknown;
  context?: AuditContext;
};

/**
 * Port for recording audit events from within bookings mutation use cases.
 * Callers call record(); failures throw so the use case can apply DEC-AU6
 * fail-loud semantics (catch, log CRITICAL, return mutation success).
 */
export type AuditWriter = {
  record: (input: AuditWriteInput) => Promise<void>;
};
