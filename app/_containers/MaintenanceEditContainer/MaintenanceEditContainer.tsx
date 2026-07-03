'use client';

// =============================================================================
// MaintenanceEditContainer — 'use client' slim proxy (DEC-EM5)
// =============================================================================
// Manages the inline maintenance-edit panel state for an existing block.
//
// State:
//   isOpen      — whether the edit panel is expanded
//   quantity    — pre-filled from booking.quantity, editable
//   startTime   — HH:MM string, pre-filled from booking.startTime via formatHHMM
//   endTime     — HH:MM string, pre-filled from booking.endTime via formatHHMM
//   notes       — pre-filled from booking.notes, editable
//   isSaving    — transition flag
//   errorMessage — last validation/server error, cleared on each save attempt
//
// On save:
//   - parseHHMM both times to get Dates
//   - client-side validate: end > start (Croatian error)
//   - build FormData { id, quantity, startTimeMs, endTimeMs, notes }
//   - call editMaintenanceAction inside useTransition
//   - close on success; show result.message on failure
//
// Slim container: ALL rendering delegates to MaintenanceEditView (pure component).
// =============================================================================

import { useState, useTransition } from 'react';
import type { Booking } from '@/modules/bookings/domain/types';
import { editMaintenanceAction } from '@/app/actions';
import { formatHHMM, parseHHMM } from '@/lib/time';
import {
  MaintenanceEditView,
  type MaintenanceEditState,
} from '@/app/_components/MaintenanceEditPanel/MaintenanceEditPanel';

type MaintenanceEditContainerProps = {
  /** The maintenance booking to edit. */
  booking: Booking;
  /** Server "now" — anchors parseHHMM to the correct day (architecture.md §3). */
  now: Date;
};

export function MaintenanceEditContainer({ booking, now }: MaintenanceEditContainerProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Pre-fill from the existing maintenance booking
  const [quantity, setQuantity] = useState(booking.quantity);
  const [startTime, setStartTime] = useState(formatHHMM(booking.startTime));
  const [endTime, setEndTime] = useState(formatHHMM(booking.endTime));
  const [notes, setNotes] = useState(booking.notes ?? '');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [isSaving, startSaveTransition] = useTransition();

  function handleSave() {
    setErrorMessage(null);

    const startDate = parseHHMM(startTime, now);
    const endDate = parseHHMM(endTime, now);

    if (!startDate || !endDate) {
      setErrorMessage('Unesi valjano početno i završno vrijeme (HH:MM).');
      return;
    }

    if (endDate.getTime() <= startDate.getTime()) {
      setErrorMessage('Završno vrijeme mora biti nakon početnog.');
      return;
    }

    const formData = new FormData();
    formData.set('id', booking.id);
    formData.set('quantity', String(quantity));
    // Serialization rule: epoch-ms (DEC-P5 / DEC-EM4)
    formData.set('startTimeMs', String(startDate.getTime()));
    formData.set('endTimeMs', String(endDate.getTime()));
    // notes: '' → server clears the field (rawNotes='' maps to null in action)
    formData.set('notes', notes);

    startSaveTransition(async () => {
      const result = await editMaintenanceAction(formData);
      if (result.success) {
        setIsOpen(false);
      } else {
        setErrorMessage(result.message);
      }
    });
  }

  // Collapsed — delegate to MaintenanceEditView (closed state = "Uredi" button)
  if (!isOpen) {
    return <MaintenanceEditView isOpen={false} onOpen={() => setIsOpen(true)} />;
  }

  // Expanded — build state, delegate ALL JSX to MaintenanceEditView (open state)
  const state: MaintenanceEditState = {
    quantity,
    startTime,
    endTime,
    notes,
    errorMessage,
    isSaving,
  };

  return (
    <MaintenanceEditView
      isOpen={true}
      state={state}
      onQuantityChange={setQuantity}
      onStartTimeChange={setStartTime}
      onEndTimeChange={setEndTime}
      onNotesChange={setNotes}
      onSave={handleSave}
      onCancel={() => setIsOpen(false)}
    />
  );
}
