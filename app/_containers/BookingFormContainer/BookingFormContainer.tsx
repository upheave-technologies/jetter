'use client';

// =============================================================================
// BookingFormContainer — 'use client' leaf
// =============================================================================
// Manages the "Nova rezervacija" form state with slot-finder flow (DEC-P5).
//
// Hero layout: primary CTA wired to targetSlot; secondary collapsible section
// for other slots, manual entry, renter name, notes, and live verdict.
//
// On quantity/duration change: calls computeOpenSlotsAction to find available
// slots. Operator taps a slot to set targetSlot.
//
// On start time change: calls computeAvailabilityAction for the live verdict.
//
// Submit → createBookingAction with startTimeMs as epoch-ms (DEC-P5).
// Gate: submit disabled when targetSlot is null OR verdict.fits=false (AC-6).
//
// Past days: form is hidden entirely (dayParam < todayParam — DEC-P2).
// =============================================================================

import { useState, useTransition } from 'react';
import {
  computeAvailabilityAction,
  computeOpenSlotsAction,
  createBookingAction,
} from '@/app/actions';
import type { AvailabilityVerdict, OpenSlotsResult } from '@/modules/bookings/domain/types';
import {
  BookingFormPanel,
  type DurationPreset,
} from '@/app/_components/BookingFormPanel/BookingFormPanel';
import {
  formatHHMM,
  parseHHMM,
  resolveStartMs,
  resolveDurationMin,
} from '@/lib/time';

type BookingFormContainerProps = {
  /** Server "now" anchors the slot finder. */
  now: Date;
  /** YYYY-MM-DD of the displayed day — hidden when < todayParam (DEC-P2). */
  dayParam: string;
  todayParam: string;
};

export function BookingFormContainer({
  now,
  dayParam,
  todayParam,
}: BookingFormContainerProps) {
  // Hide form on past days — cannot create reservations in the past (DEC-P2)
  if (dayParam < todayParam) return null;

  return <BookingFormInner now={now} />;
}

// ---------------------------------------------------------------------------
// Inner component — extracted so hooks are not called conditionally.
// ---------------------------------------------------------------------------

function BookingFormInner({ now }: { now: Date }) {
  const [quantity, setQuantity] = useState(2);
  // targetSlot: the slot the operator has committed to booking
  const [targetSlot, setTargetSlot] = useState<Date | null>(null);
  // selectedStartTime: the Date used for verdict computation (set by slot tap or manual input)
  const [selectedStartTime, setSelectedStartTime] = useState<Date | null>(null);
  const [customStartTime, setCustomStartTime] = useState('');
  const [durationPreset, setDurationPreset] = useState<DurationPreset>(30);
  const [customDurationMin, setCustomDurationMin] = useState('');
  const [renterName, setRenterName] = useState('');
  const [notes, setNotes] = useState('');
  const [verdict, setVerdict] = useState<AvailabilityVerdict | null>(null);
  const [openSlots, setOpenSlots] = useState<OpenSlotsResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSecondaryOpen, setIsSecondaryOpen] = useState(false);

  const [isComputingVerdict, startVerdictTransition] = useTransition();
  const [isComputingSlots, startSlotsTransition] = useTransition();

  // ---------------------------------------------------------------------------
  // Slot-finder — calls computeOpenSlotsAction when quantity/duration changes
  // ---------------------------------------------------------------------------

  function requestSlots(q: number, durPreset: DurationPreset, custDur: string) {
    const durationMin = resolveDurationMin(durPreset, custDur);
    if (durationMin < 1) return;

    startSlotsTransition(async () => {
      const result = await computeOpenSlotsAction({
        quantity: q,
        durationMin,
        fromTimeMs: now.getTime(),
      });
      if (result.success && result.value !== undefined) {
        setOpenSlots(result.value);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Verdict computation — calls computeAvailabilityAction for the chosen time
  // ---------------------------------------------------------------------------

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

    startVerdictTransition(async () => {
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

  // ---------------------------------------------------------------------------
  // Field change handlers
  // ---------------------------------------------------------------------------

  function handleQuantityChange(q: number) {
    setQuantity(q);
    requestSlots(q, durationPreset, customDurationMin);
    requestVerdict(q, selectedStartTime, customStartTime, durationPreset, customDurationMin);
  }

  function handleCustomStartTimeChange(v: string) {
    setCustomStartTime(v);
    const parsed = parseHHMM(v, now);
    setSelectedStartTime(parsed);
    if (parsed !== null) setTargetSlot(parsed);
    requestVerdict(quantity, parsed, v, durationPreset, customDurationMin);
  }

  function handleDurationPresetChange(p: DurationPreset) {
    setDurationPreset(p);
    requestSlots(quantity, p, customDurationMin);
    requestVerdict(quantity, selectedStartTime, customStartTime, p, customDurationMin);
  }

  function handleCustomDurationMinChange(v: string) {
    setCustomDurationMin(v);
    requestSlots(quantity, durationPreset, v);
    requestVerdict(quantity, selectedStartTime, customStartTime, durationPreset, v);
  }

  function handleSlotSelect(slot: Date) {
    setTargetSlot(slot);
    setSelectedStartTime(slot);
    setCustomStartTime(formatHHMM(slot));
    requestVerdict(quantity, slot, formatHHMM(slot), durationPreset, customDurationMin);
  }

  // ---------------------------------------------------------------------------
  // Reset
  // ---------------------------------------------------------------------------

  function resetForm() {
    setQuantity(2);
    setTargetSlot(null);
    setSelectedStartTime(null);
    setCustomStartTime('');
    setDurationPreset(30);
    setCustomDurationMin('');
    setRenterName('');
    setNotes('');
    setVerdict(null);
    setOpenSlots(null);
    setErrorMessage(null);
    setIsSecondaryOpen(false);
  }

  // ---------------------------------------------------------------------------
  // Submit — passes startTimeMs as epoch-ms (serialization rule)
  // ---------------------------------------------------------------------------

  async function handleSubmit() {
    setErrorMessage(null);
    if (targetSlot === null) {
      setErrorMessage('Odaberi slobodni termin.');
      return;
    }
    const formData = new FormData();
    formData.set('quantity', String(quantity));
    formData.set('startTimeMs', String(targetSlot.getTime()));
    formData.set('durationMin', String(resolveDurationMin(durationPreset, customDurationMin)));
    if (renterName) formData.set('renterName', renterName);
    if (notes) formData.set('notes', notes);

    const result = await createBookingAction(formData);
    if (result.success) {
      resetForm();
    } else {
      setErrorMessage(result.message);
    }
  }

  // Slim return — single component call (react-components.md §4)
  return (
    <BookingFormPanel
      quantity={quantity}
      targetSlot={targetSlot}
      customStartTime={customStartTime}
      durationPreset={durationPreset}
      customDurationMin={customDurationMin}
      renterName={renterName}
      notes={notes}
      verdict={verdict}
      isComputingVerdict={isComputingVerdict}
      openSlots={openSlots}
      isComputingSlots={isComputingSlots}
      isSecondaryOpen={isSecondaryOpen}
      errorMessage={errorMessage}
      onQuantityChange={handleQuantityChange}
      onCustomStartTimeChange={handleCustomStartTimeChange}
      onDurationPresetChange={handleDurationPresetChange}
      onCustomDurationMinChange={handleCustomDurationMinChange}
      onRenterNameChange={setRenterName}
      onNotesChange={setNotes}
      onSlotSelect={handleSlotSelect}
      onToggleSecondary={() => setIsSecondaryOpen((v) => !v)}
      onSubmitBook={handleSubmit}
    />
  );
}
