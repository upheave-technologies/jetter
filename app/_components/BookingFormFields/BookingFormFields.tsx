import { CheckCircle2, AlertCircle } from 'lucide-react';
import type { AvailabilityVerdict } from '@/modules/bookings/domain/types';
import { skuterForm } from './croatian';
import { formatHHMM } from '@/lib/time';

// ---------------------------------------------------------------------------
// BookingFormFields — pure presentational shared form body
// ---------------------------------------------------------------------------
// Shared between BookingFormPanel (create) and BookingEditPanel (edit).
// Renders: quantity segmented control, Početak picker (AC-4), duration pills,
// optional renter name, optional notes, and the live verdict line.
//
// The Početak picker (AC-4) shows absolute quarter-hour clock-time presets
// computed by the container via nextQuarterHourBoundaries(now, count) from
// lib/time. No relative offsets (+15, +30, etc.).
// ---------------------------------------------------------------------------

const QUANTITIES = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const DURATION_PRESETS: { value: DurationPreset; label: string }[] = [
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '60 min' },
  { value: 'custom', label: 'Prilagodi' },
];

export type DurationPreset = 30 | 45 | 60 | 'custom';

export type BookingFormFieldsProps = {
  // --- Core booking values ---
  quantity: number;
  /** Currently selected start time (Date for a chip selection, null if none) */
  selectedStartTime: Date | null;
  /** Value of the manual HH:MM input */
  customStartTime: string;
  durationPreset: DurationPreset;
  customDurationMin: string;
  renterName: string;
  notes: string;

  // --- Početak picker (AC-4) ---
  /**
   * First 4 quarter-hour boundaries — always shown.
   * Computed by container via nextQuarterHourBoundaries(now, 4).
   */
  primaryPresets: Date[];
  /**
   * Next 8 boundaries shown when [više…] is tapped.
   * Computed by container via nextQuarterHourBoundaries(now, 12).slice(4).
   */
  expandedPresets: Date[];
  /** Whether the [više…] expansion is currently showing */
  isExpandedPresets: boolean;

  // --- Verdict ---
  verdict: AvailabilityVerdict | null;
  isComputingVerdict: boolean;

  // --- Handlers ---
  onQuantityChange: (q: number) => void;
  onStartTimeSelect: (t: Date) => void;
  onCustomStartTimeChange: (v: string) => void;
  onToggleExpandedPresets: () => void;
  onDurationPresetChange: (p: DurationPreset) => void;
  onCustomDurationMinChange: (v: string) => void;
  onRenterNameChange: (v: string) => void;
  onNotesChange: (v: string) => void;
};

/**
 * Pure presentational shared form body.
 * Used by BookingFormPanel and BookingEditPanel.
 * No 'use client' — all interaction state managed by the container above.
 */
export function BookingFormFields({
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
}: BookingFormFieldsProps) {
  return (
    <>
      {/* ---------------------------------------------------------------- */}
      {/* Quantity — segmented control (1–8)                               */}
      {/* ---------------------------------------------------------------- */}
      <fieldset className="mb-5">
        <legend className="mb-2 text-xs font-bold text-muted-foreground uppercase tracking-widest">
          Skuteri
        </legend>
        <div
          className="grid grid-cols-8 gap-1.5"
          role="group"
          aria-label="Broj skutera"
        >
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

      {/* ---------------------------------------------------------------- */}
      {/* Početak — absolute quarter-hour clock-time chips (AC-4)          */}
      {/* ---------------------------------------------------------------- */}
      <fieldset className="mb-5">
        <legend className="mb-2 text-xs font-bold text-muted-foreground uppercase tracking-widest">
          Početak
        </legend>
        <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Početak iznajmljivanja">
          {/* First 4 boundaries — always shown */}
          {primaryPresets.map((preset) => {
            const label = formatHHMM(preset);
            const isSelected =
              selectedStartTime !== null &&
              selectedStartTime.getTime() === preset.getTime();
            return (
              <button
                key={preset.getTime()}
                type="button"
                onClick={() => onStartTimeSelect(preset)}
                aria-pressed={isSelected}
                className={`rounded-lg px-3 py-2 text-sm font-semibold tabular-nums transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95 ${
                  isSelected
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-muted text-foreground hover:bg-muted/70'
                }`}
              >
                {label}
              </button>
            );
          })}

          {/* Expanded 8 boundaries — shown when isExpandedPresets=true */}
          {isExpandedPresets &&
            expandedPresets.map((preset) => {
              const label = formatHHMM(preset);
              const isSelected =
                selectedStartTime !== null &&
                selectedStartTime.getTime() === preset.getTime();
              return (
                <button
                  key={preset.getTime()}
                  type="button"
                  onClick={() => onStartTimeSelect(preset)}
                  aria-pressed={isSelected}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold tabular-nums transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95 ${
                    isSelected
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-muted text-foreground hover:bg-muted/70'
                  }`}
                >
                  {label}
                </button>
              );
            })}

          {/* više…/manje… toggle chip */}
          <button
            type="button"
            onClick={onToggleExpandedPresets}
            aria-expanded={isExpandedPresets}
            className="rounded-lg px-3 py-2 text-sm font-semibold bg-muted text-muted-foreground hover:bg-muted/70 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
          >
            {isExpandedPresets ? 'manje…' : 'više…'}
          </button>
        </div>

        {/* Manual HH:MM input — always visible (AC-4: more prominent than old hidden state) */}
        <div className="mt-3">
          <label
            htmlFor="manual-start-time"
            className="block text-xs font-semibold text-muted-foreground mb-1.5"
          >
            Ili ručno:
          </label>
          <input
            id="manual-start-time"
            type="time"
            value={customStartTime}
            onChange={(e) => onCustomStartTimeChange(e.target.value)}
            className="rounded-lg border border-border bg-input px-3 py-2.5 text-foreground text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring w-32"
          />
        </div>
      </fieldset>

      {/* ---------------------------------------------------------------- */}
      {/* Duration — segmented pills (30 / 45 / 60 / custom)               */}
      {/* ---------------------------------------------------------------- */}
      <fieldset className="mb-5">
        <legend className="mb-2 text-xs font-bold text-muted-foreground uppercase tracking-widest">
          Trajanje
        </legend>
        <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Trajanje iznajmljivanja">
          {DURATION_PRESETS.map((p) => (
            <button
              key={p.value}
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
            <label htmlFor="custom-duration" className="text-sm text-muted-foreground">
              Minute:
            </label>
            <input
              id="custom-duration"
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

      {/* ---------------------------------------------------------------- */}
      {/* Renter name (optional)                                            */}
      {/* ---------------------------------------------------------------- */}
      <div className="mb-3">
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

      {/* ---------------------------------------------------------------- */}
      {/* Notes (optional)                                                  */}
      {/* ---------------------------------------------------------------- */}
      <div className="mb-5">
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

      {/* ---------------------------------------------------------------- */}
      {/* Live verdict (FR-5)                                               */}
      {/* ---------------------------------------------------------------- */}
      <VerdictLine verdict={verdict} isLoading={isComputingVerdict} quantity={quantity} />
    </>
  );
}

// ---------------------------------------------------------------------------
// VerdictLine — live availability result, impossible to miss when not fitting.
// AC-3: label uses the operator's selected quantity (not a separate field).
// ---------------------------------------------------------------------------

function VerdictLine({
  verdict,
  isLoading,
  quantity,
}: {
  verdict: AvailabilityVerdict | null;
  isLoading: boolean;
  quantity: number;
}) {
  if (isLoading) {
    return (
      <div className="rounded-xl bg-muted px-4 py-3 flex items-center gap-2 animate-pulse mb-0">
        <div className="h-4 w-4 rounded bg-muted-foreground/20" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">Provjera dostupnosti…</p>
      </div>
    );
  }

  if (verdict === null) {
    return null;
  }

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

  // doesn't fit branch — DEC-D: label uses operator's selected quantity
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
          ? `Slobodno za ${skuterForm(quantity)} u ${nextStr}`
          : 'Nema slobodnih termina danas'}
      </p>
    </div>
  );
}

