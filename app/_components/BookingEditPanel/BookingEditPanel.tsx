import type { AvailabilityVerdict } from '@/modules/bookings/domain/types';
import {
  BookingFormFields,
  type DurationPreset,
} from '@/app/_components/BookingFormFields/BookingFormFields';

// ---------------------------------------------------------------------------
// BookingEditPanel — pure presentational inline edit panel
// ---------------------------------------------------------------------------
// Renders under a booked row when Uredi is tapped (AC-2.2).
// Shares the BookingFormFields body with BookingFormPanel — same controls,
// pre-filled from the existing booking.
//
// AC-6.2: Spremi promjene button disabled when verdict.fits=false or loading.
//
// BookingEditView wraps the closed (Uredi button) and open (panel) states into
// a single pure component so BookingEditContainer can remain a slim proxy
// (react-components.md §4 — client containers delegate ALL rendering).
// ---------------------------------------------------------------------------

// Re-export so BookingEditContainer can import from here
export type { DurationPreset };

// ---------------------------------------------------------------------------
// BookingEditView — wraps closed + open states into a single component.
// The container renders exactly this one component.
// ---------------------------------------------------------------------------

export type BookingEditViewProps =
  | { isOpen: false; onOpen: () => void }
  | ({ isOpen: true } & BookingEditPanelProps);

export function BookingEditView(props: BookingEditViewProps) {
  if (!props.isOpen) {
    return (
      <div className="px-4 pb-4 pt-0">
        <button
          type="button"
          onClick={props.onOpen}
          className="action-btn bg-muted text-foreground"
        >
          Uredi
        </button>
      </div>
    );
  }

  // props is narrowed to { isOpen: true } & BookingEditPanelProps here;
  // strip the discriminant prop before spreading into BookingEditPanel.
  const panelProps = props as BookingEditPanelProps;
  return <BookingEditPanel {...panelProps} />;
}

export type BookingEditPanelProps = {
  // Core controlled values (pre-filled from existing booking)
  quantity: number;
  selectedStartTime: Date | null;
  customStartTime: string;
  durationPreset: DurationPreset;
  customDurationMin: string;
  renterName: string;
  notes: string;

  // Početak picker chip data
  primaryPresets: Date[];
  expandedPresets: Date[];
  isExpandedPresets: boolean;

  // Verdict
  verdict: AvailabilityVerdict | null;
  isComputingVerdict: boolean;

  // Handlers
  onQuantityChange: (q: number) => void;
  onStartTimeSelect: (t: Date) => void;
  onCustomStartTimeChange: (v: string) => void;
  onToggleExpandedPresets: () => void;
  onDurationPresetChange: (p: DurationPreset) => void;
  onCustomDurationMinChange: (v: string) => void;
  onRenterNameChange: (v: string) => void;
  onNotesChange: (v: string) => void;

  // AC-6.2 submit state
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
};

/**
 * Pure presentational inline edit panel.
 * BookingEditContainer wires all state, pre-fills from the existing booking,
 * and calls editBookingAction on save.
 */
export function BookingEditPanel({
  quantity,
  selectedStartTime,
  customStartTime,
  durationPreset,
  customDurationMin,
  renterName,
  notes,
  primaryPresets,
  expandedPresets,
  isExpandedPresets,
  verdict,
  isComputingVerdict,
  onQuantityChange,
  onStartTimeSelect,
  onCustomStartTimeChange,
  onToggleExpandedPresets,
  onDurationPresetChange,
  onCustomDurationMinChange,
  onRenterNameChange,
  onNotesChange,
  onSave,
  onCancel,
  isSaving,
}: BookingEditPanelProps) {
  // AC-6.2: disabled when verdict doesn't fit, computing, or save in progress
  const isSaveDisabled =
    isSaving || isComputingVerdict || (verdict !== null && !verdict.fits);

  return (
    <div
      className="border-t border-border bg-muted/30 px-4 pt-4 pb-5"
      aria-label="Uredi rezervaciju"
    >
      {/* Shared form fields */}
      <BookingFormFields
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
        isComputingVerdict={isComputingVerdict}
        onQuantityChange={onQuantityChange}
        onStartTimeSelect={onStartTimeSelect}
        onCustomStartTimeChange={onCustomStartTimeChange}
        onToggleExpandedPresets={onToggleExpandedPresets}
        onDurationPresetChange={onDurationPresetChange}
        onCustomDurationMinChange={onCustomDurationMinChange}
        onRenterNameChange={onRenterNameChange}
        onNotesChange={onNotesChange}
      />

      {/* ---------------------------------------------------------------- */}
      {/* Actions                                                           */}
      {/* ---------------------------------------------------------------- */}
      <div className="flex flex-col gap-2 mt-4">
        {/* Spremi promjene — AC-6.2: disabled when not fitting or loading */}
        <button
          type="button"
          onClick={onSave}
          disabled={isSaveDisabled}
          aria-disabled={isSaveDisabled}
          className={`flex items-center justify-center gap-2 w-full rounded-xl py-3.5 text-base font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] transition-all ${
            isSaveDisabled
              ? 'bg-muted text-muted-foreground opacity-60 cursor-not-allowed'
              : 'bg-primary text-primary-foreground'
          }`}
        >
          Spremi promjene
        </button>

        {/* Odustani — collapses panel without saving */}
        <button
          type="button"
          onClick={onCancel}
          className="w-full rounded-xl py-3 text-base font-semibold bg-muted text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] transition-all"
        >
          Odustani
        </button>
      </div>
    </div>
  );
}
