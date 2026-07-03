'use client';

// =============================================================================
// ConfirmButton — 'use client' container
// =============================================================================
// Slim state proxy: manages isOpen + confirm/cancel callbacks, then delegates
// ALL rendering to ConfirmButtonView (pure component).
//
// ConfirmButtonView uses Radix Dialog for accessible modal scaffolding:
//   focus trap, focus restoration, Escape key, click-outside, ARIA.
// No useEffect, no setTimeout, no document.querySelector needed.
// =============================================================================

import { useRef, useState } from 'react';
import { ConfirmButtonView } from '@/app/_components/ConfirmButtonView/ConfirmButtonView';

type ConfirmButtonProps = {
  /** Dialog title, e.g. "Vrati sve skutere?" */
  title: string;
  /** Booking summary line shown under the title */
  body: string;
  /** Label for the confirm button */
  confirmLabel: string;
  /** Label for the cancel button */
  cancelLabel: string;
  /** Style the confirm button as destructive (red) */
  destructive?: boolean;
  /** Visual classes forwarded to the visible trigger button */
  className?: string;
  children: React.ReactNode;
};

/**
 * A submit trigger that intercepts the click, shows a Radix Dialog, and only
 * fires the parent form's server action when the operator explicitly confirms.
 *
 * Delegates ALL rendering to ConfirmButtonView (pure component).
 */
export function ConfirmButton({
  title,
  body,
  confirmLabel,
  cancelLabel,
  destructive = false,
  className,
  children,
}: ConfirmButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const hiddenSubmitRef = useRef<HTMLButtonElement>(null);

  function handleConfirm() {
    setIsOpen(false);
    // Radix restores focus to the trigger on close automatically.
    // Programmatic click submits the parent form.
    hiddenSubmitRef.current?.click();
  }

  function handleCancel() {
    setIsOpen(false);
  }

  return (
    <ConfirmButtonView
      className={className}
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      hiddenSubmitRef={hiddenSubmitRef}
      title={title}
      body={body}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      destructive={destructive}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    >
      {children}
    </ConfirmButtonView>
  );
}
