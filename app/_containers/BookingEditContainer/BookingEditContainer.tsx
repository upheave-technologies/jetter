'use client';

// =============================================================================
// BookingEditContainer — 'use client' leaf
// =============================================================================
// Manages the inline edit panel for an upcoming (booked) reservation.
//
// State:
//   isOpen          — whether the edit panel is expanded
//   quantity        — pre-filled from booking, editable
//   selectedStartTime — pre-filled from booking.startTime, editable
//   customStartTime — value of the manual HH:MM input
//   durationPreset  — pre-filled from booking.durationMin
//   customDurationMin — custom duration input string
//   renterName      — pre-filled from booking.renterName
//   notes           — pre-filled from booking.notes
//   isExpandedPresets — whether [više…] is showing extra boundaries
//   verdict         — live availability result from computeAvailabilityAction
//
// The live verdict is requested (via startTransition) whenever quantity,
// start time, or duration changes — same pattern as BookingFormContainer.
// DEC-A: all fit checks route through computeAvailabilityAction → use case.
//
// Slim container: ALL rendering delegates to BookingEditView (pure component).
// =============================================================================

import { useState, useTransition } from 'react';
import { computeAvailabilityAction, editBookingAction } from '@/app/actions';
import type { Booking, AvailabilityVerdict } from '@/modules/bookings/domain/types';
import {
  BookingEditView,
  type DurationPreset,
} from '@/app/_components/BookingEditPanel/BookingEditPanel';
import {
  nextQuarterHourBoundaries,
  formatHHMM,
  parseHHMM,
  resolveStartMs,
  resolveDurationMin,
} from '@/lib/time';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function durationPresetFromMin(min: number): DurationPreset {
  if (min === 30 || min === 45 || min === 60) return min;
  return 'custom';
}

type BookingEditContainerProps = {
  booking: Booking;
  /** Server "now" — passed from the board snapshot so the picker uses a
   *  consistent time reference (architecture.md §3 — no Date.now() in client). */
  now: Date;
};

export function BookingEditContainer({ booking, now }: BookingEditContainerProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Pre-fill from existing booking
  const [quantity, setQuantity] = useState(booking.quantity);
  const [selectedStartTime, setSelectedStartTime] = useState<Date | null>(booking.startTime);
  const [customStartTime, setCustomStartTime] = useState(
    formatHHMM(booking.startTime),
  );
  const initDurationPreset = durationPresetFromMin(booking.durationMin);
  const [durationPreset, setDurationPreset] = useState<DurationPreset>(initDurationPreset);
  const [customDurationMin, setCustomDurationMin] = useState(
    initDurationPreset === 'custom' ? String(booking.durationMin) : '',
  );
  const [renterName, setRenterName] = useState(booking.renterName ?? '');
  const [notes, setNotes] = useState(booking.notes ?? '');
  const [isExpandedPresets, setIsExpandedPresets] = useState(false);
  const [verdict, setVerdict] = useState<AvailabilityVerdict | null>(null);

  const [isPending, startTransition] = useTransition();
  const [isSaving, startSaveTransition] = useTransition();

  // Quarter-hour presets anchored to `now` (server time — predictable).
  // 4 primary + 8 expanded = 12 total boundaries.
  const allPresets = nextQuarterHourBoundaries(now, 12);
  const primaryPresets = allPresets.slice(0, 4);
  const expandedPresets = allPresets.slice(4);

  // -------------------------------------------------------------------------
  // Verdict computation
  // -------------------------------------------------------------------------

  function requestVerdict(
    q: number,
    startTime: Date | null,
    custStart: string,
    durPreset: DurationPreset,
    custDur: string,
  ) {
    const startMs = resolveStartMs(startTime, custStart, now);
    if (startMs === null) return;
    const durationMin = resolveDurationMin(durPreset, custDur);
    if (durationMin < 1) return;

    startTransition(async () => {
      const result = await computeAvailabilityAction({
        quantity: q,
        startTimeMs: startMs,
        durationMin,
      });
      if (result.success && result.value !== undefined) {
        setVerdict(result.value);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Field change handlers
  // -------------------------------------------------------------------------

  function handleQuantityChange(q: number) {
    setQuantity(q);
    requestVerdict(q, selectedStartTime, customStartTime, durationPreset, customDurationMin);
  }

  function handleStartTimeSelect(t: Date) {
    setSelectedStartTime(t);
    setCustomStartTime(formatHHMM(t));
    requestVerdict(quantity, t, formatHHMM(t), durationPreset, customDurationMin);
  }

  function handleCustomStartTimeChange(v: string) {
    setCustomStartTime(v);
    const parsed = parseHHMM(v, now);
    setSelectedStartTime(parsed);
    requestVerdict(quantity, parsed, v, durationPreset, customDurationMin);
  }

  function handleDurationPresetChange(p: DurationPreset) {
    setDurationPreset(p);
    requestVerdict(quantity, selectedStartTime, customStartTime, p, customDurationMin);
  }

  function handleCustomDurationMinChange(v: string) {
    setCustomDurationMin(v);
    requestVerdict(quantity, selectedStartTime, customStartTime, durationPreset, v);
  }

  // -------------------------------------------------------------------------
  // Save / cancel
  // -------------------------------------------------------------------------

  function handleSave() {
    const startMs = resolveStartMs(selectedStartTime, customStartTime, now);
    const durationMin = resolveDurationMin(durationPreset, customDurationMin);

    startSaveTransition(async () => {
      const formData = new FormData();
      formData.set('id', booking.id);
      formData.set('quantity', String(quantity));
      if (startMs !== null) {
        // Serialization rule: Dates cross the boundary as epoch-ms (DEC-P5).
        formData.set('startTimeMs', String(startMs));
      }
      formData.set('durationMin', String(durationMin));
      formData.set('renterName', renterName);
      formData.set('notes', notes);

      const result = await editBookingAction(formData);
      if (result.success) {
        setIsOpen(false);
      }
      // On error the panel stays open so the operator can see the verdict
      // and retry. No silent override path (DEC-B).
    });
  }

  function handleOpen() {
    setIsOpen(true);
    requestVerdict(
      quantity,
      selectedStartTime,
      customStartTime,
      durationPreset,
      customDurationMin,
    );
  }

  // -------------------------------------------------------------------------
  // Render — delegate ALL JSX to BookingEditView (pure component)
  // -------------------------------------------------------------------------

  if (!isOpen) {
    return <BookingEditView isOpen={false} onOpen={handleOpen} />;
  }

  return (
    <BookingEditView
      isOpen={true}
      quantity={quantity}
      selectedStartTime={selectedStartTime}
      customStartTime={customStartTime}
      durationPreset={durationPreset}
      customDurationMin={customDurationMin}
      renterName={renterName}
      notes={notes}
      primaryPresets={primaryPresets}
      expandedPresets={expandedPresets}
      isExpandedPresets={isExpandedPresets}
      verdict={verdict}
      isComputingVerdict={isPending}
      onQuantityChange={handleQuantityChange}
      onStartTimeSelect={handleStartTimeSelect}
      onCustomStartTimeChange={handleCustomStartTimeChange}
      onToggleExpandedPresets={() => setIsExpandedPresets((v) => !v)}
      onDurationPresetChange={handleDurationPresetChange}
      onCustomDurationMinChange={handleCustomDurationMinChange}
      onRenterNameChange={setRenterName}
      onNotesChange={setNotes}
      onSave={handleSave}
      onCancel={() => setIsOpen(false)}
      isSaving={isSaving}
    />
  );
}

