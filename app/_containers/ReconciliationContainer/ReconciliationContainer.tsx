'use client';

// =============================================================================
// ReconciliationContainer — 'use client' leaf
// =============================================================================
// Manages the reconciliation proposal flow state (DEC-P6).
//
// Operator picks a disruption mode + inputs → "Izračunaj prijedlog" →
// proposeReconciliationAction returns a wire proposal →
// "Primijeni prijedlog" → applyReconciliationAction.
//
// NEVER auto-applies — operator must explicitly confirm (DEC-P6).
//
// Slim container — delegates ALL rendering to ReconciliationPanel (pure component).
// =============================================================================

import { useState, useTransition } from 'react';
import {
  proposeReconciliationAction,
  applyReconciliationAction,
} from '@/app/actions';
import type { Booking } from '@/modules/bookings/domain/types';
import {
  ReconciliationPanel,
  type DisruptionMode,
  type ReconciliationProposalWire,
} from '@/app/_components/ReconciliationPanel/ReconciliationPanel';
import { parseHHMM } from '@/lib/time';

type ReconciliationContainerProps = {
  /** Today's reservations — used to populate the booking picker. */
  reservations: Booking[];
  /** Server now — anchors parseHHMM for the dropUntil time. */
  now: Date;
};

export function ReconciliationContainer({
  reservations,
  now,
}: ReconciliationContainerProps) {
  const [disruptionMode, setDisruptionMode] = useState<DisruptionMode>('delay');
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [extraMinutes, setExtraMinutes] = useState('');
  const [dropQuantity, setDropQuantity] = useState(1);
  const [dropUntilTime, setDropUntilTime] = useState('');
  const [proposal, setProposal] = useState<ReconciliationProposalWire | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [isProposing, startProposeTransition] = useTransition();
  const [isApplying, startApplyTransition] = useTransition();

  function handlePropose() {
    setErrorMessage(null);
    setProposal(null);

    const dayMs = now.getTime();

    if (disruptionMode === 'delay') {
      if (!selectedBookingId) {
        setErrorMessage('Odaberi rezervaciju koja kasni.');
        return;
      }
      const extraMin = parseInt(extraMinutes, 10);
      if (isNaN(extraMin) || extraMin < 1) {
        setErrorMessage('Unesi valjano kašnjenje u minutama (min 1).');
        return;
      }

      startProposeTransition(async () => {
        const result = await proposeReconciliationAction({
          dayMs,
          disruption: {
            type: 'delay',
            bookingId: selectedBookingId,
            extraMinutes: extraMin,
          },
        });
        if (result.success && result.value !== undefined) {
          setProposal(result.value);
        } else if (!result.success) {
          setErrorMessage(result.message);
        }
      });
    } else {
      // capacity_drop
      const untilDate = parseHHMM(dropUntilTime, now);
      if (!untilDate) {
        setErrorMessage('Unesi valjano vrijeme do kojeg je kvar (HH:MM).');
        return;
      }

      startProposeTransition(async () => {
        const result = await proposeReconciliationAction({
          dayMs,
          disruption: {
            type: 'capacity_drop',
            quantity: dropQuantity,
            untilMs: untilDate.getTime(),
          },
        });
        if (result.success && result.value !== undefined) {
          setProposal(result.value);
        } else if (!result.success) {
          setErrorMessage(result.message);
        }
      });
    }
  }

  function handleApply() {
    if (proposal === null) return;
    setErrorMessage(null);

    startApplyTransition(async () => {
      const result = await applyReconciliationAction({ proposal });
      if (result.success) {
        setProposal(null);
        setSelectedBookingId(null);
        setExtraMinutes('');
        setDropUntilTime('');
      } else {
        setErrorMessage(result.message);
      }
    });
  }

  return (
    <ReconciliationPanel
      reservations={reservations}
      disruptionMode={disruptionMode}
      selectedBookingId={selectedBookingId}
      extraMinutes={extraMinutes}
      dropQuantity={dropQuantity}
      dropUntilTime={dropUntilTime}
      proposal={proposal}
      isProposing={isProposing}
      isApplying={isApplying}
      errorMessage={errorMessage}
      onDisruptionModeChange={(mode) => {
        setDisruptionMode(mode);
        setProposal(null);
        setErrorMessage(null);
      }}
      onBookingSelect={setSelectedBookingId}
      onExtraMinutesChange={setExtraMinutes}
      onDropQuantityChange={setDropQuantity}
      onDropUntilTimeChange={setDropUntilTime}
      onPropose={handlePropose}
      onApply={handleApply}
    />
  );
}
