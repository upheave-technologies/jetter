import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { Booking } from '@/modules/bookings/domain/types';
import { formatHHMM } from '@/lib/time';

// Wire shapes — mirror actions.ts (no import from actions.ts in _components)
export type ReconciliationChangeWire = {
  bookingId: string;
  currentStartMs: number;
  suggestedStartMs: number;
  delayMinutes: number;
};

export type ReconciliationProposalWire = {
  changes: ReconciliationChangeWire[];
  unresolvable: string[];
};

export type DisruptionMode = 'delay' | 'capacity_drop';

export type ReconciliationPanelProps = {
  /** Today's reservations — used to build the booking picker for 'delay' disruptions */
  reservations: Booking[];
  /** Currently selected disruption mode */
  disruptionMode: DisruptionMode;
  /** For 'delay': ID of the reservation that is running late */
  selectedBookingId: string | null;
  /** For 'delay': how many extra minutes */
  extraMinutes: string;
  /** For 'capacity_drop': how many scooters down */
  dropQuantity: number;
  /** For 'capacity_drop': until what time HH:MM */
  dropUntilTime: string;
  /** Proposal returned by proposeReconciliationAction (null = not yet computed) */
  proposal: ReconciliationProposalWire | null;
  /** True while proposal is being computed */
  isProposing: boolean;
  /** True while proposal is being applied */
  isApplying: boolean;
  /** Error message from propose or apply */
  errorMessage: string | null;
  onDisruptionModeChange: (mode: DisruptionMode) => void;
  onBookingSelect: (id: string) => void;
  onExtraMinutesChange: (v: string) => void;
  onDropQuantityChange: (q: number) => void;
  onDropUntilTimeChange: (v: string) => void;
  onPropose: () => void;
  onApply: () => void;
};

const DROP_QUANTITIES = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/**
 * Reconciliation proposal panel (DEC-P6).
 *
 * Two disruption modes:
 *   "Rezervacija kasni" — pick a reservation + extra minutes →
 *     proposeReconciliationAction({type:'delay', bookingId, extraMinutes}).
 *   "Kvar skutera" — N scooters down until HH:MM →
 *     proposeReconciliationAction({type:'capacity_drop', quantity, untilMs}).
 *
 * The panel renders the proposal with per-change delay info and unresolvable warnings.
 * A single "Primijeni prijedlog" button calls applyReconciliationAction.
 * NEVER auto-applies — operator must explicitly tap apply (DEC-P6).
 *
 * Shown only for today (reconciliation is about live disruption — BoardView gates this).
 * Pure presentational — all state and action calls live in ReconciliationContainer.
 */
export function ReconciliationPanel({
  reservations,
  disruptionMode,
  selectedBookingId,
  extraMinutes,
  dropQuantity,
  dropUntilTime,
  proposal,
  isProposing,
  isApplying,
  errorMessage,
  onDisruptionModeChange,
  onBookingSelect,
  onExtraMinutesChange,
  onDropQuantityChange,
  onDropUntilTimeChange,
  onPropose,
  onApply,
}: ReconciliationPanelProps) {
  return (
    <section
      className="rounded-2xl bg-card border border-border p-5 shadow-card-md"
      aria-label="Usklađivanje rasporeda"
    >
      <h2 className="text-board font-bold text-foreground mb-4 flex items-center gap-2">
        <AlertTriangle className="h-[17px] w-[17px] text-warning" aria-hidden="true" />
        Usklađivanje rasporeda
      </h2>

      {/* ---------------------------------------------------------------- */}
      {/* Disruption mode toggle                                            */}
      {/* ---------------------------------------------------------------- */}
      <fieldset className="mb-4">
        <legend className="mb-2 text-xs font-bold text-muted-foreground uppercase tracking-widest">
          Vrsta problema
        </legend>
        <div className="flex gap-1.5" role="group" aria-label="Vrsta poremećaja">
          <button
            type="button"
            onClick={() => onDisruptionModeChange('delay')}
            aria-pressed={disruptionMode === 'delay'}
            className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95 ${
              disruptionMode === 'delay'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-foreground hover:bg-muted/70'
            }`}
          >
            Rezervacija kasni
          </button>
          <button
            type="button"
            onClick={() => onDisruptionModeChange('capacity_drop')}
            aria-pressed={disruptionMode === 'capacity_drop'}
            className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95 ${
              disruptionMode === 'capacity_drop'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-foreground hover:bg-muted/70'
            }`}
          >
            Kvar skutera
          </button>
        </div>
      </fieldset>

      {/* ---------------------------------------------------------------- */}
      {/* Delay disruption fields                                           */}
      {/* ---------------------------------------------------------------- */}
      {disruptionMode === 'delay' && (
        <div className="flex flex-col gap-3 mb-4">
          <div>
            <label
              htmlFor="recon-booking"
              className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1.5"
            >
              Koja rezervacija kasni
            </label>
            <select
              id="recon-booking"
              value={selectedBookingId ?? ''}
              onChange={(e) => onBookingSelect(e.target.value)}
              className="w-full rounded-lg border border-border bg-input px-3 py-2.5 text-foreground text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Odaberi rezervaciju…</option>
              {reservations.map((b) => (
                <option key={b.id} value={b.id}>
                  {formatHHMM(b.startTime)}–{formatHHMM(b.endTime)}{' '}
                  {b.renterName ? `· ${b.renterName}` : ''}{' '}
                  · {b.quantity} skuter{b.quantity !== 1 ? 'a' : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="recon-extra-min"
              className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1.5"
            >
              Kašnjenje (minuta)
            </label>
            <input
              id="recon-extra-min"
              type="number"
              min="1"
              max="240"
              value={extraMinutes}
              onChange={(e) => onExtraMinutesChange(e.target.value)}
              placeholder="npr. 15"
              className="w-32 rounded-lg border border-border bg-input px-3 py-2.5 text-foreground text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Capacity drop disruption fields                                   */}
      {/* ---------------------------------------------------------------- */}
      {disruptionMode === 'capacity_drop' && (
        <div className="flex flex-col gap-3 mb-4">
          <fieldset>
            <legend className="mb-2 text-xs font-bold text-muted-foreground uppercase tracking-widest">
              Broj neispravnih skutera
            </legend>
            <div
              className="grid grid-cols-8 gap-1.5"
              role="group"
              aria-label="Broj neispravnih skutera"
            >
              {DROP_QUANTITIES.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => onDropQuantityChange(q)}
                  aria-pressed={dropQuantity === q}
                  className={`rounded-lg py-2 text-base font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95 ${
                    dropQuantity === q
                      ? 'bg-destructive text-destructive-foreground shadow-sm'
                      : 'bg-muted text-foreground hover:bg-muted/70'
                  }`}
                >
                  {q}
                </button>
              ))}
            </div>
          </fieldset>

          <div>
            <label
              htmlFor="recon-until"
              className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1.5"
            >
              Neispravno do
            </label>
            <input
              id="recon-until"
              type="time"
              value={dropUntilTime}
              onChange={(e) => onDropUntilTimeChange(e.target.value)}
              className="w-32 rounded-lg border border-border bg-input px-3 py-2.5 text-foreground text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Propose button                                                    */}
      {/* ---------------------------------------------------------------- */}
      <button
        type="button"
        onClick={onPropose}
        disabled={isProposing}
        aria-disabled={isProposing}
        className={`w-full flex items-center justify-center gap-2 rounded-xl py-3 text-base font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] transition-all ${
          isProposing
            ? 'bg-muted text-muted-foreground opacity-60 cursor-not-allowed'
            : 'bg-warning text-warning-foreground'
        }`}
      >
        {isProposing ? 'Računam prijedlog…' : 'Izračunaj prijedlog'}
      </button>

      {/* ---------------------------------------------------------------- */}
      {/* Error banner                                                      */}
      {/* ---------------------------------------------------------------- */}
      {errorMessage && (
        <div
          className="mt-3 rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3"
          role="alert"
          aria-live="assertive"
        >
          <p className="text-sm font-semibold text-destructive">{errorMessage}</p>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Proposal results                                                  */}
      {/* ---------------------------------------------------------------- */}
      {proposal !== null && (
        <div className="mt-4" aria-live="polite" aria-label="Prijedlog usklađivanja">
          {proposal.changes.length === 0 && proposal.unresolvable.length === 0 ? (
            <div className="rounded-xl bg-success/10 border border-success/20 px-4 py-3 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-success shrink-0" aria-hidden="true" />
              <p className="text-sm font-semibold text-success">
                Nema potrebnih pomaka — raspored je izvediv.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Changes list */}
              {proposal.changes.length > 0 && (
                <div>
                  <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">
                    Predloženi pomaci
                  </h3>
                  <ol className="flex flex-col gap-2">
                    {proposal.changes.map((change) => {
                      const currentLabel = new Date(change.currentStartMs).toLocaleTimeString(
                        'hr-HR',
                        { timeZone: 'Europe/Zagreb', hour: '2-digit', minute: '2-digit' },
                      );
                      const suggestedLabel = new Date(change.suggestedStartMs).toLocaleTimeString(
                        'hr-HR',
                        { timeZone: 'Europe/Zagreb', hour: '2-digit', minute: '2-digit' },
                      );
                      const booking = reservations.find((b) => b.id === change.bookingId);
                      const bookingLabel = booking
                        ? `${booking.renterName ?? 'Rezervacija'} · ${booking.quantity} skuter${booking.quantity !== 1 ? 'a' : ''}`
                        : `ID: ${change.bookingId.slice(0, 8)}…`;

                      return (
                        <li
                          key={change.bookingId}
                          className="rounded-xl bg-muted/40 px-4 py-3 text-sm"
                        >
                          <p className="font-semibold text-foreground">{bookingLabel}</p>
                          <p className="text-muted-foreground mt-0.5">
                            {currentLabel} →{' '}
                            <strong className="text-foreground">{suggestedLabel}</strong>{' '}
                            <span className="text-warning font-semibold">
                              (+{change.delayMinutes} min)
                            </span>
                          </p>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}

              {/* Unresolvable warnings */}
              {proposal.unresolvable.length > 0 && (
                <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3">
                  <p className="text-sm font-bold text-destructive mb-1">
                    Ne može se automatski riješiti:
                  </p>
                  <ul className="list-disc list-inside text-sm text-destructive">
                    {proposal.unresolvable.map((id) => {
                      const booking = reservations.find((b) => b.id === id);
                      return (
                        <li key={id}>
                          {booking
                            ? `${booking.renterName ?? 'Rezervacija'} ${formatHHMM(booking.startTime)}`
                            : `ID: ${id.slice(0, 8)}…`}{' '}
                          — ručno riješiti
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* Apply button — only if there are changes to apply */}
              {proposal.changes.length > 0 && (
                <button
                  type="button"
                  onClick={onApply}
                  disabled={isApplying}
                  aria-disabled={isApplying}
                  className={`w-full flex items-center justify-center gap-2 rounded-xl py-4 text-base font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] transition-all min-h-13 ${
                    isApplying
                      ? 'bg-muted text-muted-foreground opacity-60 cursor-not-allowed'
                      : 'bg-primary text-primary-foreground'
                  }`}
                >
                  {isApplying ? 'Primjenjujem…' : 'Primijeni prijedlog'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
