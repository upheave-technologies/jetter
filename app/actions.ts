'use server';

// =============================================================================
// Reservation Planning Board — Server Actions
// =============================================================================
//
// No per-user auth step: the Board has no user accounts (SPEC DEC-P1 /
// Decision #1). Per-principal session lookup and buildAbility are deliberately
// absent. Every action follows the five-step shape from server-actions.md §1:
//   1. (Auth — explicitly absent for per-user auth, documented as DEC-P1)
//   2. Extract input from FormData (or typed argument for query actions)
//   3. Presence-validate — required fields exist with correct primitive types
//   4. Call ONE use case
//   5. Revalidate path on mutations; return mapped ActionResult
//
// NOTE: a coarse app-wide shared-password gate enforced in middleware.ts
// (SPEC DEC-AG1) guards the entire app surface above this layer. DEC-P1
// still holds: there are no user accounts or per-booking authorization.
//
// SERIALIZATION RULE (DEC-P5 / DEC-P6):
// Dates cross the client↔server boundary as epoch-ms numbers (deterministic,
// no timezone ambiguity). Inside each action: new Date(ms) reconstructs;
// returned Dates → ms numbers.
//
// REMOVED (DEC-P1): sendOutAction, returnSkisAction, extendBookingAction.
// ADDED (DEC-P3): blockScooterAction.
// ADDED (DEC-P5): computeOpenSlotsAction.
// ADDED (DEC-P6): proposeReconciliationAction, applyReconciliationAction.
// ADDED (DEC-EM4): editMaintenanceAction.
// ADDED (DEC-AU4): auditContext() helper — threads request IP/userAgent into
//   every mutation use case call so audit events carry forensic metadata.
// =============================================================================

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { log } from '@/packages/shared/observability';
import { createBooking } from '@/modules/bookings/application/createBookingUseCase';
import { editBooking } from '@/modules/bookings/application/editBookingUseCase';
import { cancelBooking } from '@/modules/bookings/application/cancelBookingUseCase';
import { blockScooter } from '@/modules/bookings/application/blockScooterUseCase';
import { editMaintenance } from '@/modules/bookings/application/editMaintenanceUseCase';
import { computeAvailability } from '@/modules/bookings/application/computeAvailabilityUseCase';
import { computeOpenSlots } from '@/modules/bookings/application/computeOpenSlotsUseCase';
import { proposeReconciliation } from '@/modules/bookings/application/proposeReconciliationUseCase';
import { applyReconciliation } from '@/modules/bookings/application/applyReconciliationUseCase';
import type {
  BookingId,
  AvailabilityVerdict,
  OpenSlotsResult,
  ReconciliationChange,
} from '@/modules/bookings/domain/types';
import type { AuditContext } from '@/modules/audit/domain/types';

// ---------------------------------------------------------------------------
// Shared ActionResult type
// ---------------------------------------------------------------------------

type ActionResult<T = void> =
  | { success: true; value?: T }
  | { success: false; code: string; message: string; details?: unknown };

// ---------------------------------------------------------------------------
// Error code → Croatian string mapping (architecture.md §2: no raw internal
// messages echo'd to client; mapped codes only).
// ---------------------------------------------------------------------------

function mapError(code: string): string {
  switch (code) {
    case 'CAPACITY_EXCEEDED':
      return 'Nema dovoljno skutera dostupnih u tom terminu';
    case 'PAST_START':
      return 'Termin je u prošlosti';
    case 'IMMUTABLE_PAST':
      return 'Prošle rezervacije se ne mogu mijenjati';
    case 'NOT_FOUND':
      return 'Rezervacija nije pronađena';
    case 'VALIDATION_ERROR':
      return 'Neispravan unos podataka';
    case 'SERVICE_ERROR':
      return 'Greška servisa — pokušajte ponovo';
    case 'RECONCILIATION_STALE':
      return 'Prijedlog više nije izvediv — predložite ponovo';
    default:
      return 'Neočekivana greška';
  }
}

// ---------------------------------------------------------------------------
// auditContext — request metadata for audit events (DEC-AU4 / T-B)
// ---------------------------------------------------------------------------
// Reads request headers (async in Next.js 16) to build a forensic AuditContext.
// Called inside every mutation action and passed as `context` into the use case.
// The use case threads ip + userAgent into the audit_events.metadata column.
//
// Security note (architecture.md §2): only ip + userAgent are captured here.
// No session credentials, no passwords, no secrets are collected or logged.
// ---------------------------------------------------------------------------

async function auditContext(): Promise<AuditContext> {
  const h = await headers();
  const xff = h.get('x-forwarded-for');
  const ip = xff ? xff.split(',')[0]!.trim() : (h.get('x-real-ip') ?? undefined);
  const userAgent = h.get('user-agent') ?? undefined;
  return { actor: 'operator', ip, userAgent };
}

// ---------------------------------------------------------------------------
// createBookingAction
// ---------------------------------------------------------------------------
// DEC-P1: reservation is the sole source of truth for availability.
// The operator provides an explicit startTime (no 'now' magic; they pick a slot
// from the slot-finder or enter an absolute time — DEC-P5).
// ---------------------------------------------------------------------------

const createLog = log.child({ source: 'actions.createBookingAction' });

export async function createBookingAction(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  createLog.info('action.entered', { hasInput: !!formData });

  // 1. Auth — absent (SPEC DEC-P1 / Decision #1)

  // 2. Extract
  const rawQuantity = formData.get('quantity') as string | null;
  const rawStartTimeMs = formData.get('startTimeMs') as string | null;
  const rawDurationMin = formData.get('durationMin') as string | null;
  const rawRenterName = formData.get('renterName') as string | null;
  const rawNotes = formData.get('notes') as string | null;

  // 3. Presence-validate
  if (!rawQuantity || !rawStartTimeMs || !rawDurationMin) {
    createLog.info('action.completed', { ok: false });
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'quantity, startTimeMs and durationMin are required',
    };
  }

  const quantity = parseInt(rawQuantity, 10);
  const startTimeMs = parseInt(rawStartTimeMs, 10);
  const durationMin = parseInt(rawDurationMin, 10);

  if (isNaN(quantity) || isNaN(startTimeMs) || isNaN(durationMin)) {
    createLog.info('action.completed', { ok: false });
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'quantity, startTimeMs and durationMin must be integers',
    };
  }

  const startTime = new Date(startTimeMs);
  if (isNaN(startTime.getTime())) {
    createLog.info('action.completed', { ok: false });
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'startTimeMs must be a valid epoch-ms timestamp',
    };
  }

  // 4. Call ONE use case (context threaded for audit — DEC-AU4 / T-B)
  const result = await createBooking({
    quantity,
    startTime,
    durationMin,
    renterName: rawRenterName || null,
    notes: rawNotes || null,
    context: await auditContext(),
  });

  // 5. Return / revalidate
  if (!result.success) {
    createLog.info('action.completed', { ok: false, code: result.error.code });
    return {
      success: false,
      code: result.error.code,
      message: mapError(result.error.code),
    };
  }

  revalidatePath('/');
  createLog.info('action.completed', { ok: true });
  return { success: true, value: { id: result.value.id } };
}

// ---------------------------------------------------------------------------
// editBookingAction
// ---------------------------------------------------------------------------
// DEC-P2: past/started reservations are immutable — use case enforces
// IMMUTABLE_PAST. Only future reservations are editable.
// ---------------------------------------------------------------------------

const editLog = log.child({ source: 'actions.editBookingAction' });

export async function editBookingAction(
  formData: FormData,
): Promise<ActionResult> {
  editLog.info('action.entered', { hasInput: !!formData });

  // 1. Auth — absent

  // 2. Extract
  const id = formData.get('id') as string | null;
  const rawQuantity = formData.get('quantity') as string | null;
  const rawStartTimeMs = formData.get('startTimeMs') as string | null;
  const rawDurationMin = formData.get('durationMin') as string | null;
  const rawRenterName = formData.get('renterName') as string | null;
  const rawNotes = formData.get('notes') as string | null;

  // 3. Presence-validate — only id is required; all others are optional edits
  if (!id) {
    editLog.info('action.completed', { ok: false });
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'id is required',
    };
  }

  // Parse optional numeric fields — validate only if provided
  let quantity: number | undefined;
  if (rawQuantity !== null && rawQuantity !== '') {
    quantity = parseInt(rawQuantity, 10);
    if (isNaN(quantity)) {
      editLog.info('action.completed', { ok: false });
      return {
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'quantity must be an integer',
      };
    }
  }

  let durationMin: number | undefined;
  if (rawDurationMin !== null && rawDurationMin !== '') {
    durationMin = parseInt(rawDurationMin, 10);
    if (isNaN(durationMin)) {
      editLog.info('action.completed', { ok: false });
      return {
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'durationMin must be an integer',
      };
    }
  }

  let startTime: Date | undefined;
  if (rawStartTimeMs !== null && rawStartTimeMs !== '') {
    const ms = parseInt(rawStartTimeMs, 10);
    if (isNaN(ms)) {
      editLog.info('action.completed', { ok: false });
      return {
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'startTimeMs must be a valid epoch-ms integer',
      };
    }
    startTime = new Date(ms);
    if (isNaN(startTime.getTime())) {
      editLog.info('action.completed', { ok: false });
      return {
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'startTimeMs must be a valid epoch-ms timestamp',
      };
    }
  }

  // renterName and notes: empty string → clear the field (null); absent → no change.
  const renterName: string | null | undefined =
    rawRenterName !== null ? (rawRenterName === '' ? null : rawRenterName) : undefined;
  const notes: string | null | undefined =
    rawNotes !== null ? (rawNotes === '' ? null : rawNotes) : undefined;

  // 4. Call ONE use case (context threaded for audit — DEC-AU4 / T-B)
  const result = await editBooking({
    id: id as BookingId,
    quantity,
    startTime,
    durationMin,
    renterName,
    notes,
    context: await auditContext(),
  });

  // 5. Return / revalidate
  if (!result.success) {
    editLog.info('action.completed', { ok: false, code: result.error.code });
    return {
      success: false,
      code: result.error.code,
      message: mapError(result.error.code),
    };
  }

  revalidatePath('/');
  editLog.info('action.completed', { ok: true });
  return { success: true };
}

// ---------------------------------------------------------------------------
// cancelBookingAction
// ---------------------------------------------------------------------------
// DEC-P2: cancellable only if future (reservation) or not yet ended (maintenance).
// The use case delegates to domain/booking.ts#canCancel.
// ---------------------------------------------------------------------------

const cancelLog = log.child({ source: 'actions.cancelBookingAction' });

export async function cancelBookingAction(
  formData: FormData,
): Promise<ActionResult> {
  cancelLog.info('action.entered', { hasInput: !!formData });

  // 1. Auth — absent

  // 2. Extract
  const id = formData.get('id') as string | null;

  // 3. Presence-validate
  if (!id) {
    cancelLog.info('action.completed', { ok: false });
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'id is required',
    };
  }

  // 4. Call ONE use case (context threaded for audit — DEC-AU4 / T-B)
  const result = await cancelBooking({ id: id as BookingId, context: await auditContext() });

  // 5. Return / revalidate
  if (!result.success) {
    cancelLog.info('action.completed', { ok: false, code: result.error.code });
    return {
      success: false,
      code: result.error.code,
      message: mapError(result.error.code),
    };
  }

  revalidatePath('/');
  cancelLog.info('action.completed', { ok: true });
  return { success: true };
}

// ---------------------------------------------------------------------------
// blockScooterAction
// ---------------------------------------------------------------------------
// DEC-P3: mark N scooters unavailable for a window via kind='maintenance'.
// No fits() check — maintenance blocks are honest over-commitment signals.
// Both startTime and endTime are passed as epoch-ms (serialization rule).
// ---------------------------------------------------------------------------

const blockLog = log.child({ source: 'actions.blockScooterAction' });

export async function blockScooterAction(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  blockLog.info('action.entered', { hasInput: !!formData });

  // 1. Auth — absent

  // 2. Extract
  const rawQuantity = formData.get('quantity') as string | null;
  const rawStartTimeMs = formData.get('startTimeMs') as string | null;
  const rawEndTimeMs = formData.get('endTimeMs') as string | null;
  const rawNotes = formData.get('notes') as string | null;

  // 3. Presence-validate
  if (!rawQuantity || !rawStartTimeMs || !rawEndTimeMs) {
    blockLog.info('action.completed', { ok: false });
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'quantity, startTimeMs and endTimeMs are required',
    };
  }

  const quantity = parseInt(rawQuantity, 10);
  const startTimeMs = parseInt(rawStartTimeMs, 10);
  const endTimeMs = parseInt(rawEndTimeMs, 10);

  if (isNaN(quantity) || isNaN(startTimeMs) || isNaN(endTimeMs)) {
    blockLog.info('action.completed', { ok: false });
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'quantity, startTimeMs and endTimeMs must be integers',
    };
  }

  const startTime = new Date(startTimeMs);
  const endTime = new Date(endTimeMs);

  if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
    blockLog.info('action.completed', { ok: false });
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'startTimeMs and endTimeMs must be valid epoch-ms timestamps',
    };
  }

  // 4. Call ONE use case (context threaded for audit — DEC-AU4 / T-B)
  const result = await blockScooter({
    quantity,
    startTime,
    endTime,
    notes: rawNotes || null,
    context: await auditContext(),
  });

  // 5. Return / revalidate
  if (!result.success) {
    blockLog.info('action.completed', { ok: false, code: result.error.code });
    return {
      success: false,
      code: result.error.code,
      message: mapError(result.error.code),
    };
  }

  revalidatePath('/');
  blockLog.info('action.completed', { ok: true });
  return { success: true, value: { id: result.value.id } };
}

// ---------------------------------------------------------------------------
// computeAvailabilityAction
// ---------------------------------------------------------------------------
// FR-5 / DEC-P5: live verdict while the form is open.
// Query only — no revalidatePath.
// Typed argument (not FormData): pure query invoked directly from a client
// container, not from a <form action>.
// ---------------------------------------------------------------------------

const availabilityLog = log.child({ source: 'actions.computeAvailabilityAction' });

export async function computeAvailabilityAction(input: {
  quantity: number;
  startTimeMs: number;
  durationMin: number;
}): Promise<ActionResult<AvailabilityVerdict>> {
  availabilityLog.info('action.entered', { hasInput: true });

  // 1. Auth — absent

  // 2/3. Typed object — validate primitive types.
  if (
    typeof input.quantity !== 'number' ||
    typeof input.startTimeMs !== 'number' ||
    typeof input.durationMin !== 'number'
  ) {
    availabilityLog.info('action.completed', { ok: false });
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'quantity, startTimeMs and durationMin must be numbers',
    };
  }

  const startTime = new Date(input.startTimeMs);
  if (isNaN(startTime.getTime())) {
    availabilityLog.info('action.completed', { ok: false });
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'startTimeMs must be a valid epoch-ms timestamp',
    };
  }

  // 4. Call ONE use case
  const result = await computeAvailability({
    quantity: input.quantity,
    startTime,
    durationMin: input.durationMin,
  });

  // 5. Return (query — no revalidatePath)
  if (!result.success) {
    availabilityLog.info('action.completed', { ok: false });
    return {
      success: false,
      code: result.error.code,
      message: mapError(result.error.code),
    };
  }

  availabilityLog.info('action.completed', { ok: true });
  return { success: true, value: result.value };
}

// ---------------------------------------------------------------------------
// computeOpenSlotsAction
// ---------------------------------------------------------------------------
// DEC-P5: slot-finder query — first possible slot + other open slots.
// Query only — no revalidatePath.
// Typed argument; fromTime passed as epoch-ms (serialization rule).
// ---------------------------------------------------------------------------

const openSlotsLog = log.child({ source: 'actions.computeOpenSlotsAction' });

export async function computeOpenSlotsAction(input: {
  quantity: number;
  durationMin: number;
  fromTimeMs: number;
}): Promise<ActionResult<OpenSlotsResult>> {
  openSlotsLog.info('action.entered', { hasInput: true });

  // 1. Auth — absent

  // 2/3. Typed object — validate primitive types.
  if (
    typeof input.quantity !== 'number' ||
    typeof input.durationMin !== 'number' ||
    typeof input.fromTimeMs !== 'number'
  ) {
    openSlotsLog.info('action.completed', { ok: false });
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'quantity, durationMin and fromTimeMs must be numbers',
    };
  }

  const fromTime = new Date(input.fromTimeMs);
  if (isNaN(fromTime.getTime())) {
    openSlotsLog.info('action.completed', { ok: false });
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'fromTimeMs must be a valid epoch-ms timestamp',
    };
  }

  // 4. Call ONE use case
  const result = await computeOpenSlots({
    quantity: input.quantity,
    durationMin: input.durationMin,
    fromTime,
  });

  // 5. Return (query — no revalidatePath)
  if (!result.success) {
    openSlotsLog.info('action.completed', { ok: false });
    return {
      success: false,
      code: result.error.code,
      message: mapError(result.error.code),
    };
  }

  openSlotsLog.info('action.completed', { ok: true });
  return { success: true, value: result.value };
}

// ---------------------------------------------------------------------------
// Serializable disruption / proposal shapes
// ---------------------------------------------------------------------------
// Dates cannot cross the client↔server boundary as Date objects — they must
// be serialized as epoch-ms numbers.  These wire-types are the client-facing
// shapes; the action reconstructs domain types before calling use cases, and
// serializes domain types back to ms before returning.

/** Wire shape for a 'delay' disruption. */
type DisruptionDelayWire = {
  type: 'delay';
  bookingId: string;
  extraMinutes: number;
};

/** Wire shape for a 'capacity_drop' disruption (until as ms). */
type DisruptionCapacityDropWire = {
  type: 'capacity_drop';
  quantity: number;
  untilMs: number;
};

type DisruptionWire = DisruptionDelayWire | DisruptionCapacityDropWire;

/** Wire shape for one reconciliation change (Dates as ms). */
type ReconciliationChangeWire = {
  bookingId: string;
  currentStartMs: number;
  suggestedStartMs: number;
  delayMinutes: number;
};

/** Wire shape for a full serializable reconciliation proposal. */
type ReconciliationProposalWire = {
  changes: ReconciliationChangeWire[];
  unresolvable: string[];
};

// Helper: domain ReconciliationChange → wire
function changeToWire(c: ReconciliationChange): ReconciliationChangeWire {
  return {
    bookingId: c.bookingId,
    currentStartMs: c.currentStart.getTime(),
    suggestedStartMs: c.suggestedStart.getTime(),
    delayMinutes: c.delayMinutes,
  };
}

// ---------------------------------------------------------------------------
// proposeReconciliationAction
// ---------------------------------------------------------------------------
// DEC-P6: compute the minimal proposal — never auto-applies.
// Query only — no revalidatePath.
// Disruption dates serialized as ms in the wire input.
// Proposal dates serialized as ms in the wire output.
// ---------------------------------------------------------------------------

const proposeLog = log.child({ source: 'actions.proposeReconciliationAction' });

export async function proposeReconciliationAction(input: {
  dayMs: number;
  disruption: DisruptionWire;
}): Promise<ActionResult<ReconciliationProposalWire>> {
  proposeLog.info('action.entered', { hasInput: true });

  // 1. Auth — absent

  // 2/3. Validate primitive types.
  if (typeof input.dayMs !== 'number') {
    proposeLog.info('action.completed', { ok: false });
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'dayMs must be a number',
    };
  }

  const day = new Date(input.dayMs);
  if (isNaN(day.getTime())) {
    proposeLog.info('action.completed', { ok: false });
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'dayMs must be a valid epoch-ms timestamp',
    };
  }

  if (!input.disruption || !input.disruption.type) {
    proposeLog.info('action.completed', { ok: false });
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'disruption is required',
    };
  }

  // Reconstruct the domain Disruption from the wire shape.
  let disruption;
  if (input.disruption.type === 'delay') {
    const d = input.disruption as DisruptionDelayWire;
    if (!d.bookingId || typeof d.extraMinutes !== 'number') {
      proposeLog.info('action.completed', { ok: false });
      return {
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'delay disruption requires bookingId and extraMinutes',
      };
    }
    disruption = {
      type: 'delay' as const,
      bookingId: d.bookingId as BookingId,
      extraMinutes: d.extraMinutes,
    };
  } else if (input.disruption.type === 'capacity_drop') {
    const d = input.disruption as DisruptionCapacityDropWire;
    if (typeof d.quantity !== 'number' || typeof d.untilMs !== 'number') {
      proposeLog.info('action.completed', { ok: false });
      return {
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'capacity_drop disruption requires quantity and untilMs',
      };
    }
    const until = new Date(d.untilMs);
    if (isNaN(until.getTime())) {
      proposeLog.info('action.completed', { ok: false });
      return {
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'untilMs must be a valid epoch-ms timestamp',
      };
    }
    disruption = {
      type: 'capacity_drop' as const,
      quantity: d.quantity,
      until,
    };
  } else {
    proposeLog.info('action.completed', { ok: false });
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'disruption.type must be "delay" or "capacity_drop"',
    };
  }

  // 4. Call ONE use case
  const result = await proposeReconciliation({ day, disruption });

  // 5. Return (query — no revalidatePath); serialize Dates → ms
  if (!result.success) {
    proposeLog.info('action.completed', { ok: false });
    return {
      success: false,
      code: result.error.code,
      message: mapError(result.error.code),
    };
  }

  const wireProposal: ReconciliationProposalWire = {
    changes: result.value.changes.map(changeToWire),
    unresolvable: result.value.unresolvable,
  };

  proposeLog.info('action.completed', { ok: true });
  return { success: true, value: wireProposal };
}

// ---------------------------------------------------------------------------
// applyReconciliationAction
// ---------------------------------------------------------------------------
// DEC-P6: mutation — operator explicitly applied the proposal.
// Input is the wire proposal produced by proposeReconciliationAction;
// Dates are reconstructed from ms before calling the use case.
// ---------------------------------------------------------------------------

const applyLog = log.child({ source: 'actions.applyReconciliationAction' });

export async function applyReconciliationAction(input: {
  proposal: ReconciliationProposalWire;
}): Promise<ActionResult<{ applied: number; skipped: number }>> {
  applyLog.info('action.entered', { hasInput: true });

  // 1. Auth — absent

  // 2/3. Validate structure.
  if (
    !input.proposal ||
    !Array.isArray(input.proposal.changes) ||
    !Array.isArray(input.proposal.unresolvable)
  ) {
    applyLog.info('action.completed', { ok: false });
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'proposal must have changes and unresolvable arrays',
    };
  }

  // Reconstruct domain ReconciliationProposal (ms → Date).
  const changes: ReconciliationChange[] = input.proposal.changes.map((c) => ({
    bookingId: c.bookingId as BookingId,
    currentStart: new Date(c.currentStartMs),
    suggestedStart: new Date(c.suggestedStartMs),
    delayMinutes: c.delayMinutes,
  }));

  const unresolvable = input.proposal.unresolvable.map(
    (id) => id as BookingId,
  );

  // 4. Call ONE use case (context threaded for audit — DEC-AU4 / T-B)
  const result = await applyReconciliation({
    proposal: { changes, unresolvable },
    context: await auditContext(),
  });

  // 5. Return / revalidate
  if (!result.success) {
    applyLog.info('action.completed', { ok: false, code: result.error.code });
    return {
      success: false,
      code: result.error.code,
      message: mapError(result.error.code),
    };
  }

  revalidatePath('/');
  applyLog.info('action.completed', { ok: true });
  return { success: true, value: result.value };
}

// ---------------------------------------------------------------------------
// editMaintenanceAction
// ---------------------------------------------------------------------------
// DEC-EM4: edit an existing maintenance block (quantity, start, end, notes).
// All fields except id are optional — only provided fields change.
// Dates cross as epoch-ms (serialization rule — DEC-P5).
// No fits() check — maintenance is honest over-commitment (DEC-P3 / DEC-EM3).
// ---------------------------------------------------------------------------

const editMaintenanceLog = log.child({ source: 'actions.editMaintenanceAction' });

export async function editMaintenanceAction(
  formData: FormData,
): Promise<ActionResult> {
  editMaintenanceLog.info('action.entered', { hasInput: !!formData });

  // 1. Auth — absent (SPEC DEC-P1)

  // 2. Extract
  const id = formData.get('id') as string | null;
  const rawQuantity = formData.get('quantity') as string | null;
  const rawStartTimeMs = formData.get('startTimeMs') as string | null;
  const rawEndTimeMs = formData.get('endTimeMs') as string | null;
  const rawNotes = formData.get('notes') as string | null;

  // 3. Presence-validate — only id is required; all others are optional edits
  if (!id) {
    editMaintenanceLog.info('action.completed', { ok: false });
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'id is required',
    };
  }

  // Parse optional quantity — validate only if provided
  let quantity: number | undefined;
  if (rawQuantity !== null && rawQuantity !== '') {
    quantity = parseInt(rawQuantity, 10);
    if (isNaN(quantity)) {
      editMaintenanceLog.info('action.completed', { ok: false });
      return {
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'quantity must be an integer',
      };
    }
  }

  // Parse optional startTime (epoch-ms) — validate only if provided
  let startTime: Date | undefined;
  if (rawStartTimeMs !== null && rawStartTimeMs !== '') {
    const ms = parseInt(rawStartTimeMs, 10);
    if (isNaN(ms)) {
      editMaintenanceLog.info('action.completed', { ok: false });
      return {
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'startTimeMs must be a valid epoch-ms integer',
      };
    }
    startTime = new Date(ms);
    if (isNaN(startTime.getTime())) {
      editMaintenanceLog.info('action.completed', { ok: false });
      return {
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'startTimeMs must be a valid epoch-ms timestamp',
      };
    }
  }

  // Parse optional endTime (epoch-ms) — validate only if provided
  let endTime: Date | undefined;
  if (rawEndTimeMs !== null && rawEndTimeMs !== '') {
    const ms = parseInt(rawEndTimeMs, 10);
    if (isNaN(ms)) {
      editMaintenanceLog.info('action.completed', { ok: false });
      return {
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'endTimeMs must be a valid epoch-ms integer',
      };
    }
    endTime = new Date(ms);
    if (isNaN(endTime.getTime())) {
      editMaintenanceLog.info('action.completed', { ok: false });
      return {
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'endTimeMs must be a valid epoch-ms timestamp',
      };
    }
  }

  // notes: empty string → null (clear the field); absent → undefined (no change).
  // Mirrors editBookingAction's exact notes-handling.
  const notes: string | null | undefined =
    rawNotes !== null ? (rawNotes === '' ? null : rawNotes) : undefined;

  // 4. Call ONE use case (context threaded for audit — DEC-AU4 / DEC-EM6)
  const result = await editMaintenance({
    id: id as BookingId,
    quantity,
    startTime,
    endTime,
    notes,
    context: await auditContext(),
  });

  // 5. Return / revalidate
  if (!result.success) {
    editMaintenanceLog.info('action.completed', { ok: false, code: result.error.code });
    return {
      success: false,
      code: result.error.code,
      message: mapError(result.error.code),
    };
  }

  revalidatePath('/');
  editMaintenanceLog.info('action.completed', { ok: true });
  return { success: true };
}
