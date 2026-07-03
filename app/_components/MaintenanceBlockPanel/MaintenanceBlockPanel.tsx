import { Wrench } from 'lucide-react';

export type MaintenanceFormState = {
  quantity: number;
  startTime: string;
  endTime: string;
  notes: string;
  isOpen: boolean;
  errorMessage: string | null;
  isPending: boolean;
};

export type MaintenanceBlockPanelProps = {
  state: MaintenanceFormState;
  onQuantityChange: (q: number) => void;
  onStartTimeChange: (v: string) => void;
  onEndTimeChange: (v: string) => void;
  onNotesChange: (v: string) => void;
  onToggleOpen: () => void;
  onSubmit: () => void;
};

// Fleet size — mirrors domain FLEET_SIZE = 6 (DEC-P10, 2026-07-03 fleet reduction 8→6).
// app/ cannot import modules/**/domain/config (only domain/types is public — project-structure §4),
// so the fleet cap is mirrored here. Keep in lockstep with domain/config.ts.
const FLEET_SIZE = 6;
const QUANTITIES = Array.from({ length: FLEET_SIZE }, (_, i) => i + 1);

/**
 * Maintenance block creation panel (DEC-P3).
 *
 * Collapsible secondary panel so it stays out of the primary flow's way.
 * Operator picks: quantity, start HH:MM, end HH:MM, optional notes.
 * Submit → blockScooterAction (called by the container).
 *
 * Pure presentational — all state and submit logic live in MaintenanceFormContainer.
 * Server-compatible shape (no 'use client' here); rendered inside a client container.
 */
export function MaintenanceBlockPanel({
  state,
  onQuantityChange,
  onStartTimeChange,
  onEndTimeChange,
  onNotesChange,
  onToggleOpen,
  onSubmit,
}: MaintenanceBlockPanelProps) {
  const { quantity, startTime, endTime, notes, isOpen, errorMessage, isPending } = state;

  return (
    <section
      className="rounded-2xl bg-card border border-border shadow-card-md overflow-hidden"
      aria-label="Označi nedostupnost"
    >
      {/* Collapsible trigger */}
      <button
        type="button"
        onClick={onToggleOpen}
        aria-expanded={isOpen}
        className="flex items-center justify-between w-full px-5 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-center gap-2 font-bold text-board text-foreground">
          <Wrench className="h-[17px] w-[17px]" aria-hidden="true" />
          Označi nedostupnost / kvar
        </span>
        <span
          className={`text-muted-foreground text-lg font-bold transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
          aria-hidden="true"
        >
          ›
        </span>
      </button>

      {/* Collapsible body */}
      {isOpen && (
        <div className="border-t border-border px-5 pt-4 pb-5">
          {/* Quantity */}
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

          {/* Start + End time */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label
                htmlFor="maintenance-start"
                className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1.5"
              >
                Od
              </label>
              <input
                id="maintenance-start"
                type="time"
                value={startTime}
                onChange={(e) => onStartTimeChange(e.target.value)}
                className="w-full rounded-lg border border-border bg-input px-3 py-2.5 text-foreground text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div>
              <label
                htmlFor="maintenance-end"
                className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1.5"
              >
                Do
              </label>
              <input
                id="maintenance-end"
                type="time"
                value={endTime}
                onChange={(e) => onEndTimeChange(e.target.value)}
                className="w-full rounded-lg border border-border bg-input px-3 py-2.5 text-foreground text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>

          {/* Notes */}
          <div className="mb-4">
            <label
              htmlFor="maintenance-notes"
              className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1.5"
            >
              Napomena <span className="font-normal normal-case">(neobavezno)</span>
            </label>
            <input
              id="maintenance-notes"
              type="text"
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
              placeholder="npr. kvar motora, servis…"
              className="w-full rounded-lg border border-border bg-input px-3 py-2.5 text-foreground text-base placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {/* Error banner */}
          {errorMessage && (
            <div
              className="mb-3 rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3"
              role="alert"
              aria-live="assertive"
            >
              <p className="text-sm font-semibold text-destructive">{errorMessage}</p>
            </div>
          )}

          {/* Submit */}
          <button
            type="button"
            onClick={onSubmit}
            disabled={isPending}
            aria-disabled={isPending}
            className={`w-full flex items-center justify-center gap-2 rounded-xl py-3.5 text-base font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] transition-all min-h-13 ${
              isPending
                ? 'bg-muted text-muted-foreground opacity-60 cursor-not-allowed'
                : 'bg-warning text-warning-foreground'
            }`}
          >
            <Wrench className="h-[17px] w-[17px]" aria-hidden="true" />
            {isPending ? 'Blokiram…' : 'Blokiraj skutere'}
          </button>
        </div>
      )}
    </section>
  );
}
