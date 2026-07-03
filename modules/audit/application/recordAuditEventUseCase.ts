// =============================================================================
// Audit Module — Record Audit Event Use Case
// =============================================================================
// Appends one immutable audit event to the log.
//
// ID strategy: generated here in the application layer via createId() from
// @paralleldrive/cuid2, consistent with how the bookings module generates
// nanoid IDs in the use case (not relying on schema $defaultFn at runtime).
// The $defaultFn in the schema is the DB-level fallback; the use case generates
// the id so the returned AuditEvent carries the id immediately (same pattern
// as createBookingUseCase generating nanoid before repo.save).
//
// occurredAt: set here (new Date()) — the application shell is the correct
// place for I/O (donnie-rules §1: domain must not call Date.now()).
//
// actor: defaults to 'operator' if context.actor is absent (DEC-AU4 — the
// platform has one shared operator, no principals).
// =============================================================================

import { createId } from '@paralleldrive/cuid2';

import type { Result } from '@/packages/shared/lib/result';
import { log } from '@/packages/shared/observability';
import type { AuditEvent, RecordAuditEventInput, AuditError } from '../domain/types';
import type { IAuditEventRepository } from '../domain/repository';
import { auditErr } from './auditError';

const useCaseLog = log.child({ source: 'audit.recordAuditEventUseCase' });

export type RecordAuditEventDeps = {
  auditRepo: IAuditEventRepository;
};

export const makeRecordAuditEventUseCase = (deps: RecordAuditEventDeps) => {
  return async (
    input: RecordAuditEventInput,
  ): Promise<Result<AuditEvent, AuditError>> => {
    const { auditRepo } = deps;

    // --- Validation -------------------------------------------------------

    if (!input.entityType) {
      return {
        success: false,
        error: auditErr('VALIDATION_ERROR', 'entityType is required'),
      };
    }

    if (!input.action) {
      return {
        success: false,
        error: auditErr('VALIDATION_ERROR', 'action is required'),
      };
    }

    // --- Build the audit event -------------------------------------------

    const now = new Date();
    const actor = input.context?.actor ?? input.actor ?? 'operator';

    // Merge forensic context (ip, userAgent) into metadata
    const contextMetadata: Record<string, unknown> = {};
    if (input.context?.ip) contextMetadata['ip'] = input.context.ip;
    if (input.context?.userAgent) contextMetadata['userAgent'] = input.context.userAgent;

    const mergedMetadata: Record<string, unknown> | null =
      Object.keys(contextMetadata).length > 0 || input.metadata
        ? { ...(input.metadata ?? {}), ...contextMetadata }
        : null;

    const event: AuditEvent = {
      id: createId(),
      occurredAt: now,
      entityType: input.entityType,
      action: input.action,
      entityId: input.entityId ?? null,
      actor,
      summary: input.summary ?? null,
      // Cast before/after to Record<string, unknown> | null — callers pass
      // arbitrary domain snapshots (Booking objects etc.); we accept unknown
      // and cast at the boundary. The DB stores them as jsonb.
      before: input.before != null
        ? (input.before as Record<string, unknown>)
        : null,
      after: input.after != null
        ? (input.after as Record<string, unknown>)
        : null,
      metadata: mergedMetadata,
    };

    useCaseLog.debug('audit.record_started', {
      entityType: input.entityType,
      action: input.action,
      entityId: input.entityId ?? null,
    });

    // --- Append -----------------------------------------------------------

    try {
      await auditRepo.append(event);
    } catch (err) {
      useCaseLog.error(
        'audit.append_failed',
        err instanceof Error ? err : new Error(String(err)),
        { entityType: input.entityType, action: input.action, eventId: event.id },
      );
      return {
        success: false,
        error: auditErr('SERVICE_ERROR', 'Failed to record audit event'),
      };
    }

    useCaseLog.info('audit.recorded', {
      eventId: event.id,
      entityType: input.entityType,
      action: input.action,
    });

    return { success: true, value: event };
  };
};

// ---------------------------------------------------------------------------
// Pre-wired instance
// ---------------------------------------------------------------------------

import { auditEventRepository } from '../infrastructure/repositories/DrizzleAuditEventRepository';

export const recordAuditEvent = makeRecordAuditEventUseCase({
  auditRepo: auditEventRepository,
});
