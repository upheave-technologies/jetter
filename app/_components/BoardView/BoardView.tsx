import type { DayBoard } from '@/modules/bookings/domain/types';
import { AvailabilityHeader } from '@/app/_components/AvailabilityHeader/AvailabilityHeader';
import { DayNav } from '@/app/_components/DayNav/DayNav';
import { DensityChart } from '@/app/_components/DensityChart/DensityChart';
import { BookingsList } from '@/app/_components/BookingsList/BookingsList';
import { UtilizationPanel } from '@/app/_components/UtilizationPanel/UtilizationPanel';
import { BoardTabsContainer } from '@/app/_containers/BoardTabsContainer/BoardTabsContainer';
import { BookingFormContainer } from '@/app/_containers/BookingFormContainer/BookingFormContainer';
import { MaintenanceFormContainer } from '@/app/_containers/MaintenanceFormContainer/MaintenanceFormContainer';
import { ReconciliationContainer } from '@/app/_containers/ReconciliationContainer/ReconciliationContainer';

// ---------------------------------------------------------------------------
// BoardView props — reservation-pivot contract.
// ---------------------------------------------------------------------------
type BoardViewProps = {
  board: DayBoard;
  fine: boolean;
  dayParam: string;
  prevDayParam: string;
  nextDayParam: string;
  todayParam: string;
  isToday: boolean;
};

/**
 * Top-level page layout for the Reservation Planning Board.
 *
 * Two-tab layout (via BoardTabsContainer):
 * - Tab A "Raspored": booking form, reservations list, maintenance form, reconciliation.
 * - Tab B "Gustoća": density chart, utilization panel.
 *
 * Server-rendered panels are passed as children to the client BoardTabsContainer
 * (server-components-as-children-of-client-component pattern — no client boundary
 * contamination of the panels themselves).
 *
 *   ┌─────────────────────────────┐
 *   │ AvailabilityHeader (sticky) │ ← free-now / utilization + clock
 *   ├─────────────────────────────┤
 *   │ DayNav                      │ ← Prev / Date / Next / Today
 *   ├─────────────────────────────┤
 *   │ BoardTabsContainer          │ ← Raspored | Gustoća tab bar (client)
 *   │  ├ Panel A: Raspored        │   ← form, list, maintenance, reconciliation
 *   │  └ Panel B: Gustoća         │   ← density chart + utilization
 *   └─────────────────────────────┘
 *
 * Server component — orchestrates the layout, mounts client leaves at the
 * minimum client surface (server-first-react.md §4).
 */
export function BoardView({
  board,
  fine,
  dayParam,
  prevDayParam,
  nextDayParam,
  todayParam,
  isToday,
}: BoardViewProps) {
  const rasporedPanel = (
    <main className="flex-1 px-4 py-4 pb-safe max-w-xl mx-auto w-full flex flex-col gap-4">
      {/* Create form + slot-finder (hidden on past days — container gates this) */}
      <BookingFormContainer now={board.now} dayParam={dayParam} todayParam={todayParam} />

      {/* Reservations + maintenance blocks list */}
      <BookingsList
        reservations={board.reservations}
        maintenance={board.maintenance}
        now={board.now}
        isToday={isToday}
      />

      {/* Maintenance block form — collapsible secondary panel */}
      <MaintenanceFormContainer now={board.now} />

      {/* Reconciliation panel — today only (live disruption context) */}
      {isToday && <ReconciliationContainer reservations={board.reservations} now={board.now} />}
    </main>
  );

  const gustocaPanel = (
    <main className="flex-1 px-4 py-4 pb-safe max-w-xl mx-auto w-full flex flex-col gap-4">
      {/* Density chart — glanceable "popular times" visualization */}
      <DensityChart
        density={board.density}
        bucketMin={board.bucketMin}
        dayParam={dayParam}
        fine={fine}
        windowStart={board.windowStart}
        windowEnd={board.windowEnd}
      />

      {/* Daily utilization review */}
      <UtilizationPanel
        utilization={board.utilization}
        windowStart={board.windowStart}
        windowEnd={board.windowEnd}
      />
    </main>
  );

  return (
    <div className="flex flex-col min-h-dvh bg-background">
      {/* Sticky availability header */}
      <AvailabilityHeader board={board} />

      {/* Day navigation */}
      <DayNav
        dayParam={dayParam}
        prevDayParam={prevDayParam}
        nextDayParam={nextDayParam}
        todayParam={todayParam}
        isToday={isToday}
        fine={fine}
      />

      {/* Two-tab content: Raspored + Gustoća */}
      <BoardTabsContainer rasporedTab={rasporedPanel} gustocaTab={gustocaPanel} />

    </div>
  );
}
