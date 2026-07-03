import { CalendarPlus, Bookmark, ChevronDown, ChevronUp, Clock } from 'lucide-react';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import type { AvailabilityVerdict, OpenSlotsResult } from '@/modules/bookings/domain/types';
import type { DurationPreset } from '@/app/_components/BookingFormFields/BookingFormFields';
import { formatHHMM } from '@/lib/time';

// Re-export DurationPreset so the container can import from a single location
export type { DurationPreset };

// Fleet size — mirrors domain FLEET_SIZE = 6 (DEC-P10, 2026-07-03 fleet reduction 8→6).
// app/ cannot import modules/**/domain/config (only domain/types is public — project-structure §4),
// so the fleet cap is mirrored here. Keep in lockstep with domain/config.ts.
const FLEET_SIZE = 6;
const QUANTITIES = Array.from({ length: FLEET_SIZE }, (_, i) => i + 1);
const DURATION_PRESETS: { value: DurationPreset; label: string }[] = [
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '60 min' },
  { value: 'custom', label: 'Prilagodi' },
];

export type BookingFormPanelProps = {
  // Core controlled values
  quantity: number;
  targetSlot: Date | null;
  customStartTime: string;
  durationPreset: DurationPreset;
  customDurationMin: string;
  renterName: string;
  notes: string;

  // Verdict
  verdict: AvailabilityVerdict | null;
  isComputingVerdict: boolean;

  // Slot-finder results (DEC-P5)
  openSlots: OpenSlotsResult | null;
  isComputingSlots: boolean;

  // Secondary section state
  isSecondaryOpen: boolean;

  /** Error message from the server action. */
  errorMessage?: string | null;

  // Handlers
  onQuantityChange: (q: number) => void;
  onCustomStartTimeChange: (v: string) => void;
  onDurationPresetChange: (p: DurationPreset) => void;
  onCustomDurationMinChange: (v: string) => void;
  onRenterNameChange: (v: string) => void;
  onNotesChange: (v: string) => void;

  // Slot-finder tap → pre-fills the start time
  onSlotSelect: (slot: Date) => void;

  // Toggle secondary section
  onToggleSecondary: () => void;

  // Submit
  onSubmitBook: () => void;
};

/**
 * Pure presentational create form panel with slot-finder (DEC-P5).
 *
 * Hero layout: primary card + collapsible secondary section.
 * Primary card: quantity stepper, duration presets, first-free-slot hero, CTA.
 * Secondary: other slots, manual time input, renter name, notes, live verdict.
 *
 * BookingFormContainer wires all state, handlers, verdict and slot calls.
 */
export function BookingFormPanel({
  quantity,
  targetSlot,
  customStartTime,
  durationPreset,
  customDurationMin,
  renterName,
  notes,
  verdict,
  isComputingVerdict,
  openSlots,
  isComputingSlots,
  isSecondaryOpen,
  errorMessage,
  onQuantityChange,
  onCustomStartTimeChange,
  onDurationPresetChange,
  onCustomDurationMinChange,
  onRenterNameChange,
  onNotesChange,
  onSlotSelect,
  onToggleSecondary,
  onSubmitBook,
}: BookingFormPanelProps) {
  const isSubmitDisabled =
    isComputingVerdict || targetSlot === null || (verdict !== null && !verdict.fits);

  const ctaLabel =
    targetSlot !== null ? `Rezerviraj u ${formatHHMM(targetSlot)}` : 'Odaberi termin';

  return (
    <div className="flex flex-col gap-3">
      {/* PRIMARY CARD */}
      <section
        className="rounded-2xl bg-card border border-border p-5 shadow-card-md"
        aria-label="Nova rezervacija"
      >
        <h2 className="text-foreground font-bold text-board mb-5 flex items-center gap-2">
          <CalendarPlus className="h-5 w-5" aria-hidden="true" />
          Nova rezervacija
        </h2>

        {/* Quantity */}
        <fieldset className="mb-4">
          <legend className="mb-2 text-xs font-bold text-muted-foreground uppercase tracking-widest">
            Skuteri
          </legend>
          <div className="grid grid-cols-6 gap-1.5" role="group" aria-label="Broj skutera">
            {QUANTITIES.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => onQuantityChange(q)}
                aria-pressed={quantity === q}
                className={`rounded-lg py-2 text-base font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95 ${
                  quantity === q
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-muted text-foreground hover:bg-muted/70'
                }`}
              >
                {q}
              </button>
            ))}
          </div>
        </fieldset>

        {/* Duration */}
        <fieldset className="mb-5">
          <legend className="mb-2 text-xs font-bold text-muted-foreground uppercase tracking-widest">
            Trajanje
          </legend>
          <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Trajanje iznajmljivanja">
            {DURATION_PRESETS.map((p) => (
              <button
                key={String(p.value)}
                type="button"
                onClick={() => onDurationPresetChange(p.value)}
                aria-pressed={durationPreset === p.value}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95 ${
                  durationPreset === p.value
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-muted text-foreground hover:bg-muted/70'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {durationPreset === 'custom' && (
            <div className="mt-2 flex items-center gap-2">
              <label htmlFor="custom-duration-primary" className="text-sm text-muted-foreground">
                Minute:
              </label>
              <input
                id="custom-duration-primary"
                type="number"
                min="5"
                max="480"
                value={customDurationMin}
                onChange={(e) => onCustomDurationMinChange(e.target.value)}
                className="w-24 rounded-lg border border-border bg-input px-3 py-2 text-foreground text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          )}
        </fieldset>

        {/* First free slot — hero block */}
        <div
          className="mb-5 rounded-xl border border-border bg-muted/20 p-3"
          aria-live="polite"
          aria-label="Prvi slobodni termin"
        >
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            Prvi slobodni termin
          </p>

          {isComputingSlots && (
            <div className="flex gap-1.5 animate-pulse">
              {[1, 2, 3].map((n) => (
                <div key={n} className="h-12 w-20 rounded-xl bg-muted" />
              ))}
            </div>
          )}

          {!isComputingSlots && openSlots === null && (
            <p className="text-sm text-muted-foreground py-2">Odaberi parametre</p>
          )}

          {!isComputingSlots && openSlots !== null && openSlots.firstSlot === null && (
            <p className="text-sm text-muted-foreground py-2">
              Nema slobodnih termina za odabrane parametre
            </p>
          )}

          {!isComputingSlots && openSlots !== null && openSlots.firstSlot !== null && (
            <button
              type="button"
              onClick={() => onSlotSelect(openSlots.firstSlot!)}
              aria-pressed={
                targetSlot !== null && targetSlot.getTime() === openSlots.firstSlot!.getTime()
              }
              className={`w-full rounded-xl px-4 py-3 text-2xl font-extrabold text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] ${
                targetSlot !== null && targetSlot.getTime() === openSlots.firstSlot!.getTime()
                  ? 'bg-success text-success-foreground'
                  : 'bg-success/10 text-success border border-success/25'
              }`}
            >
              {formatHHMM(openSlots.firstSlot)}
            </button>
          )}
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

        {/* Primary CTA */}
        <button
          type="button"
          onClick={onSubmitBook}
          disabled={isSubmitDisabled}
          aria-disabled={isSubmitDisabled}
          className={`flex items-center justify-center gap-2 w-full rounded-xl py-4 text-base font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] transition-all ${
            isSubmitDisabled
              ? 'bg-muted text-muted-foreground opacity-60 cursor-not-allowed'
              : 'bg-primary text-primary-foreground'
          }`}
        >
          <Bookmark className="h-5 w-5" aria-hidden="true" />
          {ctaLabel}
        </button>
      </section>

      {/* SECONDARY SECTION — collapsible */}
      <div className="rounded-2xl bg-card border border-border shadow-card-md overflow-hidden">
        <button
          type="button"
          onClick={onToggleSecondary}
          aria-expanded={isSecondaryOpen}
          aria-controls="booking-secondary-panel"
          className="w-full flex items-center justify-between px-5 py-4 text-sm font-bold text-muted-foreground hover:text-foreground transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span>Ostali termini i napredne opcije</span>
          {isSecondaryOpen ? (
            <ChevronUp className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          )}
        </button>

        {isSecondaryOpen && (
          <div id="booking-secondary-panel" className="px-5 pb-5 flex flex-col gap-4">
            {/* Other available slots */}
            {openSlots !== null && openSlots.slots.length > 1 && (
              <div>
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">
                  Ostali termini
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {openSlots.slots.slice(1).map((slot) => {
                    const isSelected = targetSlot !== null && targetSlot.getTime() === slot.getTime();
                    return (
                      <button
                        key={slot.getTime()}
                        type="button"
                        onClick={() => onSlotSelect(slot)}
                        aria-pressed={isSelected}
                        className={`rounded-lg px-3 py-2 text-sm font-semibold tabular-nums transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95 ${
                          isSelected
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'bg-muted text-foreground hover:bg-muted/70'
                        }`}
                      >
                        {formatHHMM(slot)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Manual time input */}
            <div>
              <label
                htmlFor="manual-start-time"
                className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1.5"
              >
                Ručno unesite termin (HH:MM)
              </label>
              <input
                id="manual-start-time"
                type="time"
                value={customStartTime}
                onChange={(e) => onCustomStartTimeChange(e.target.value)}
                className="rounded-lg border border-border bg-input px-3 py-2.5 text-foreground text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring w-32"
              />
            </div>

            {/* Renter name */}
            <div>
              <label
                htmlFor="renter-name"
                className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1.5"
              >
                Ime <span className="font-normal normal-case">(neobavezno)</span>
              </label>
              <input
                id="renter-name"
                type="text"
                value={renterName}
                onChange={(e) => onRenterNameChange(e.target.value)}
                placeholder="npr. Marko, crvene hlače…"
                className="w-full rounded-lg border border-border bg-input px-3 py-2.5 text-foreground text-base placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            {/* Notes */}
            <div>
              <label
                htmlFor="booking-notes"
                className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1.5"
              >
                Napomena <span className="font-normal normal-case">(neobavezno)</span>
              </label>
              <textarea
                id="booking-notes"
                value={notes}
                onChange={(e) => onNotesChange(e.target.value)}
                rows={2}
                placeholder="Nešto još…"
                className="w-full rounded-lg border border-border bg-input px-3 py-2.5 text-foreground text-base placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
              />
            </div>

            {/* Live verdict */}
            <VerdictLine verdict={verdict} isLoading={isComputingVerdict} quantity={quantity} />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VerdictLine — live availability feedback
// ---------------------------------------------------------------------------

type VerdictLineProps = {
  verdict: AvailabilityVerdict | null;
  isLoading: boolean;
  quantity: number;
};

function VerdictLine({ verdict, isLoading, quantity }: VerdictLineProps) {
  if (isLoading) {
    return (
      <div className="rounded-xl bg-muted px-4 py-3 flex items-center gap-2 animate-pulse">
        <div className="h-4 w-4 rounded bg-muted-foreground/20" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">Provjera dostupnosti…</p>
      </div>
    );
  }
  if (verdict === null) return null;
  if (verdict.fits) {
    return (
      <div
        className="rounded-xl bg-success px-4 py-3 flex items-center gap-2"
        role="status"
        aria-live="polite"
      >
        <CheckCircle2 className="h-4 w-4 text-success-foreground shrink-0" aria-hidden="true" />
        <p className="text-sm font-semibold text-success-foreground">
          Stane — {verdict.freeAtSlot} slobodnih
        </p>
      </div>
    );
  }
  const nextStr =
    verdict.nextOpeningAt !== null
      ? verdict.nextOpeningAt.toLocaleTimeString('hr-HR', {
          timeZone: 'Europe/Zagreb',
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;
  return (
    <div
      className="rounded-xl bg-warning px-4 py-3 flex items-start gap-2"
      role="status"
      aria-live="polite"
    >
      <AlertCircle className="h-4 w-4 text-warning-foreground shrink-0 mt-0.5" aria-hidden="true" />
      <p className="text-sm font-semibold text-warning-foreground">
        {nextStr
          ? `Slobodno za ${quantity} skutera u ${nextStr}`
          : 'Nema slobodnih termina danas'}
      </p>
    </div>
  );
}
