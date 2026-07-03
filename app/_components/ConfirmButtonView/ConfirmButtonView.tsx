// Pure presentational component for the ConfirmButton pattern.
// All state and handlers live in ConfirmButton (_containers/); this file is
// props → JSX only.
//
// Radix Dialog is used here for accessible modal scaffolding:
//   - Focus trap while open
//   - Focus restoration to the trigger on close
//   - Escape key → onOpenChange(false)
//   - Click-outside → onInteractOutside → onOpenChange(false)
//   - ARIA: role="dialog", aria-modal, aria-labelledby, aria-describedby
//
// This component has no 'use client' directive — it is always rendered within
// the client boundary established by ConfirmButton (_containers/), so Radix's
// React-context internals work correctly via inherited client context.

import * as RadixDialog from '@radix-ui/react-dialog';

// ---------------------------------------------------------------------------
// ConfirmButtonView — full trigger + Radix Dialog, pure props → JSX.
// The ConfirmButton container renders exactly this one component.
// ---------------------------------------------------------------------------

export type ConfirmButtonViewProps = {
  /** Content of the visible trigger button */
  children: React.ReactNode;
  /** Classes forwarded to the trigger <button> element */
  className?: string;
  /** Controlled open state managed by the container */
  isOpen: boolean;
  /** Called by Radix when open state should change (Escape, outside click) */
  onOpenChange: (open: boolean) => void;
  /** Ref forwarded to the hidden submit button */
  hiddenSubmitRef: React.RefObject<HTMLButtonElement | null>;
  /** Dialog content props */
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmButtonView({
  children,
  className,
  isOpen,
  onOpenChange,
  hiddenSubmitRef,
  title,
  body,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmButtonViewProps) {
  return (
    <>
      <RadixDialog.Root open={isOpen} onOpenChange={onOpenChange}>
        {/* Trigger — asChild threads open/close ARIA attrs onto the button */}
        <RadixDialog.Trigger asChild>
          <button type="button" className={className}>
            {children}
          </button>
        </RadixDialog.Trigger>

        <RadixDialog.Portal>
          {/* Backdrop */}
          <RadixDialog.Overlay className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm" />

          {/* Dialog card — Radix provides role="dialog" aria-modal aria-labelledby aria-describedby */}
          <RadixDialog.Content
            onInteractOutside={() => onOpenChange(false)}
            onEscapeKeyDown={() => onOpenChange(false)}
            className="fixed bottom-6 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-2xl bg-card border border-border shadow-card-md p-5 flex flex-col gap-4"
          >
            {/* Radix wires these to aria-labelledby / aria-describedby on the content */}
            <RadixDialog.Title className="text-foreground font-bold text-base text-center">
              {title}
            </RadixDialog.Title>
            <RadixDialog.Description className="text-muted-foreground text-sm text-center leading-relaxed">
              {body}
            </RadixDialog.Description>

            {/* Action buttons */}
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={onConfirm}
                className={`w-full rounded-xl py-3.5 text-base font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] transition-all ${
                  destructive
                    ? 'bg-destructive text-destructive-foreground'
                    : 'bg-primary text-primary-foreground'
                }`}
              >
                {confirmLabel}
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="w-full rounded-xl py-3 text-base font-semibold bg-muted text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] transition-all"
              >
                {cancelLabel}
              </button>
            </div>
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>

      {/* Hidden real submit — clicked programmatically after confirmation.
          Placed outside the Dialog so it persists in the DOM for form submission. */}
      <button
        ref={hiddenSubmitRef}
        type="submit"
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
      />
    </>
  );
}
