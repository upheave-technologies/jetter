// =============================================================================
// Bookings Module — AuditWriter Adapter
// =============================================================================
// Implements the AuditWriter port by calling the audit module's PUBLIC
// pre-wired use case recordAuditEvent.
//
// Isolation (SPEC DEC-AU5, donnie-rules §6.4):
//   This is the ONLY place in the bookings module that imports from the audit
//   module. The import is to the audit module's public use case file — the
//   only allowed cross-module import path. No audit internals are imported.
//
// Error behaviour:
//   recordAuditEvent returns Result<AuditEvent, AuditError>. If it returns
//   success: false, this adapter THROWS so the calling use case can catch and
//   apply DEC-AU6 fail-loud semantics (log CRITICAL, return mutation success).
//   Throwing rather than silently absorbing the failure keeps the failure
//   visible at the use case layer, which decides the fail-open/fail-closed
//   policy.
// =============================================================================

import type { AuditWriter, AuditWriteInput } from '../../application/ports/auditWriter';

// Cross-module import through the public use case surface — the §6.4 firewall.
import { recordAuditEvent } from '@/modules/audit/application/recordAuditEventUseCase';

/**
 * Creates an AuditWriter adapter backed by the audit module's recordAuditEvent
 * pre-wired use case.
 */
export function makeAuditWriterAdapter(): AuditWriter {
  return {
    async record(input: AuditWriteInput): Promise<void> {
      const result = await recordAuditEvent({
        entityType: input.entityType,
        action: input.action,
        entityId: input.entityId ?? null,
        summary: input.summary ?? null,
        before: input.before,
        after: input.after,
        context: input.context,
      });

      if (!result.success) {
        // Throw so the calling use case catches and applies DEC-AU6 semantics
        // (log CRITICAL, return mutation success — the action genuinely happened).
        throw new Error(
          `AuditWriter failed [${result.error.code}]: ${result.error.message}`,
        );
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Pre-wired singleton
// ---------------------------------------------------------------------------

/**
 * Process-wide AuditWriter singleton, wired to the audit module's pre-wired
 * recordAuditEvent use case. Shared by all bookings mutation use cases.
 */
export const auditWriter = makeAuditWriterAdapter();
