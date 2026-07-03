import { Wrench } from 'lucide-react';

// =============================================================================
// MaintenanceEditPanel — pure presentational inline edit panel (DEC-EM5)
// =============================================================================
// Renders the maintenance-block edit form: quantity 1–6 grid, Od/Do time
// inputs, notes field, Save/Cancel buttons, and an error banner.
//
// Mirrors MaintenanceBlockPanel's warning-token styling (DEC-EM5).
// NO availability verdict — maintenance skips the fits() check (DEC-EM1/DEC-P3).
//
// MaintenanceEditView wraps both the closed-state affordance ("Uredi" button)
// and the open edit panel so MaintenanceEditContainer stays a slim proxy
// (react-components.md §4 — client containers delegate ALL rendering).
//
// Pure presentational — all state and submit logic live in
// MaintenanceEditContainer ('use client').
// =============================================================================

export type MaintenanceEditState = {
  quantity: number;
  startTime: string;
  endTime: string;
  notes: string;
  errorMessage: string | null;
  isSaving: boolean;
};

export type MaintenanceEditPanelProps = {
  state: MaintenanceEditState;
  onQuantityChange: (q: number) => void;
  onStartTimeChange: (v: string) => void;
  onEndTimeChange: (v: string) => void;
  onNotesChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
};

// ---------------------------------------------------------------------------
// MaintenanceEditView — discriminated union: closed shows the affordance;
// open shows the full edit panel. The container renders exactly this component.
// ---------------------------------------------------------------------------

export type MaintenanceEditViewProps =
  | { isOpen: false; onOpen: () => void }
  | ({ isOpen: true } & MaintenanceEditPanelProps);

export function MaintenanceEditView(props: MaintenanceEditViewProps) {
  if (!props.isOpen) {
    return (
      <div className="px-4 pb-4 pt-0">
        <button
          type="button"
          onClick={props.onOpen}
          className="action-btn bg-muted text-warning"
        >
          Uredi
        </button>
      </div>
    );
  }

  const panelProps = props as MaintenanceEditPanelProps;
  return <MaintenanceEditPanel {...panelProps} />;
}

// Fleet size — mirrors domain FLEET_SIZE = 6 (DEC-P10, 2026-07-03 fleet reduction 8→6).
// app/ cannot import modules/**/domain/config (only domain/types is public — project-structure §4),
// so the fleet cap is mirrored here. Keep in lockstep with domain/config.ts.
const FLEET_SIZE = 6;
const QUANTITIES = Array.from({ length: FLEET_SIZE }, (_, i) => i + 1);

/**
 * Inline edit panel for an existing maintenance block (DEC-EM5).
 *
 * Croatian copy consistent with the create panel ("Uredi nedostupnost").
 * Warning-token colour scheme mirrors MaintenanceBlockPanel.
 * Accessibility floor: every input has a label, every action is a <button>,
 * focus-visible rings match the ring token.
 */
export function MaintenanceEditPanel({
  state,
  onQuantityChange,
  onStartTimeChange,
  onEndTimeChange,
  onNotesChange,
  onSave,
  onCancel,
}: MaintenanceEditPanelProps) {
  const { quantity, startTime, endTime, notes, errorMessage, isSaving } = state;

  return (
    <div
      className="border-t border-border bg-muted/30 px-4 pt-4 pb-5"
      aria-label="Uredi nedostupnost"
    >
      {/* Title */}
      <p className="flex items-center gap-2 mb-4 font-bold text-board text-foreground">
        <Wrench className="h-[17px] w-[17px] text-warning shrink-0" aria-hidden="true" />
        Uredi nedostupnost
      </p>

      {/* ------------------------------------------------------------------ */}
      {/* Quantity picker                                                      */}
      {/* ------------------------------------------------------------------ */}
      <fieldset className="mb-4">
        <legend className="mb-2 text-xs font-bold text-muted-foreground uppercase tracking-widest">
          Broj skutera
        </legend>
        <div
          className="grid grid-cols-6 gap-1.5"
          role="group"
          aria-label="Broj nedostupnih skutera"
        >
          {QUANTITIES.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => onQuantityChange(q)}
              aria-pressed={quantity === q}
              className={`rounded-lg py-2 text-base font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95 ${
                quantity === q
                  ? 'bg-warning text-warning-foreground shadow-sm'
                  : 'bg-muted text-foreground hover:bg-muted/70'
              }`}
            >
              {q}
            </button>
          ))}
        </div>
      </fieldset>

      {/* ------------------------------------------------------------------ */}
      {/* Od / Do time inputs                                                  */}
      {/* ------------------------------------------------------------------ */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label
            htmlFor="maintenance-edit-start"
            className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1.5"
          >
            Od
          </label>
          <input
            id="maintenance-edit-start"
            type="time"
            value={startTime}
            onChange={(e) => onStartTimeChange(e.target.value)}
            className="w-full rounded-lg border border-border bg-input px-3 py-2.5 text-foreground text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div>
          <label
            htmlFor="maintenance-edit-end"
            className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1.5"
          >
            Do
          </label>
          <input
            id="maintenance-edit-end"
            type="time"
            value={endTime}
            onChange={(e) => onEndTimeChange(e.target.value)}
            className="w-full rounded-lg border border-border bg-input px-3 py-2.5 text-foreground text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Notes                                                                */}
      {/* ------------------------------------------------------------------ */}
      <div className="mb-4">
        <label
          htmlFor="maintenance-edit-notes"
          className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1.5"
        >
          Napomena <span className="font-normal normal-case">(neobavezno)</span>
        </label>
        <input
          id="maintenance-edit-notes"
          type="text"
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="npr. kvar motora, servis…"
          className="w-full rounded-lg border border-border bg-input px-3 py-2.5 text-foreground text-base placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Error banner                                                         */}
      {/* ------------------------------------------------------------------ */}
      {errorMessage && (
        <div
          className="mb-3 rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3"
          role="alert"
          aria-live="assertive"
        >
          <p className="text-sm font-semibold text-destructive">{errorMessage}</p>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Actions                                                              */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex flex-col gap-2">
        {/* Spremi — save */}
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          aria-disabled={isSaving}
          className={`flex items-center justify-center gap-2 w-full rounded-xl py-3.5 text-base font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] transition-all ${
            isSaving
              ? 'bg-muted text-muted-foreground opacity-60 cursor-not-allowed'
              : 'bg-warning text-warning-foreground'
          }`}
        >
          <Wrench className="h-[17px] w-[17px]" aria-hidden="true" />
          {isSaving ? 'Spremam…' : 'Spremi'}
        </button>

        {/* Odustani — cancel without saving */}
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
