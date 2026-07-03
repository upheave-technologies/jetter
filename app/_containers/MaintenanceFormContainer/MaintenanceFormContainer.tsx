'use client';

// =============================================================================
// MaintenanceFormContainer — 'use client' leaf
// =============================================================================
// Manages the maintenance block creation form state (DEC-P3).
// Calls blockScooterAction with startTimeMs and endTimeMs as epoch-ms.
//
// Slim container — delegates ALL rendering to MaintenanceBlockPanel (pure component).
// =============================================================================

import { useState, useTransition } from 'react';
import { blockScooterAction } from '@/app/actions';
import {
  MaintenanceBlockPanel,
  type MaintenanceFormState,
} from '@/app/_components/MaintenanceBlockPanel/MaintenanceBlockPanel';
import { parseHHMM } from '@/lib/time';

type MaintenanceFormContainerProps = {
  /** Server "now" — anchors parseHHMM so the day context is correct. */
  now: Date;
};

export function MaintenanceFormContainer({ now }: MaintenanceFormContainerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [notes, setNotes] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [isPending, startTransition] = useTransition();

  function handleSubmit() {
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
    formData.set('quantity', String(quantity));
    // Serialization rule: epoch-ms (DEC-P5 / actions.ts contract)
    formData.set('startTimeMs', String(startDate.getTime()));
    formData.set('endTimeMs', String(endDate.getTime()));
    if (notes) formData.set('notes', notes);

    startTransition(async () => {
      const result = await blockScooterAction(formData);
      if (result.success) {
        // Reset form on success
        setQuantity(1);
        setStartTime('');
        setEndTime('');
        setNotes('');
        setIsOpen(false);
      } else {
        setErrorMessage(result.message);
      }
    });
  }

  const state: MaintenanceFormState = {
    quantity,
    startTime,
    endTime,
    notes,
    isOpen,
    errorMessage,
    isPending,
  };

  return (
    <MaintenanceBlockPanel
      state={state}
      onQuantityChange={setQuantity}
      onStartTimeChange={setStartTime}
      onEndTimeChange={setEndTime}
      onNotesChange={setNotes}
      onToggleOpen={() => setIsOpen((v) => !v)}
      onSubmit={handleSubmit}
    />
  );
}
