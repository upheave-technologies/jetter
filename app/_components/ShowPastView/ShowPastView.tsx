import { ChevronDown } from 'lucide-react';

type ShowPastViewProps = {
  /** How many past reservations are hidden (shown on collapsed label). */
  count: number;
  /** Whether the past list is currently visible. */
  expanded: boolean;
  /** Toggle callback from the client container. */
  onToggle: () => void;
  /** Server-rendered past BookingRow list — stays a server component. */
  children: React.ReactNode;
};

/**
 * ShowPastView — pure presentational wrapper for the "show / hide past
 * reservations" affordance on today's board (DEC-TF3, AC-1).
 *
 * Receives all state and callbacks from ShowPastContainer. Contains no hooks.
 * Children are passed in as a ReactNode so the past BookingRow elements remain
 * server components — the same pattern BoardTabsContainer uses (AC-7).
 *
 * Design-system: semantic <button>, aria-expanded + aria-controls, chevron icon
 * that rotates with state (frankie-rules §5, DEC-TF3).
 *
 * Server component — pure props → JSX.
 */
export function ShowPastView({
  count,
  expanded,
  onToggle,
  children,
}: ShowPastViewProps) {
  return (
    <div className="mt-2">
      {/* Toggle — semantic <button>, aria-expanded, aria-controls */}
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="past-reservations-list"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-dashed border-border bg-card px-4 py-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span>
          {expanded ? 'Sakrij protekle' : `Prikaži protekle (${count})`}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition-transform duration-200 ${
            expanded ? 'rotate-180' : 'rotate-0'
          }`}
          aria-hidden="true"
        />
      </button>

      {/* Past reservations — revealed when expanded */}
      {expanded && (
        <div id="past-reservations-list" className="mt-3">
          {children}
        </div>
      )}
    </div>
  );
}
