'use client';

/**
 * ShowPastContainer — slim 'use client' state proxy for the "show/hide past
 * reservations" toggle on today's board (DEC-TF3, AC-1, AC-7).
 *
 * Holds ONLY the ephemeral open/closed boolean. All rendering is delegated to
 * ShowPastView — the same server-components-as-children-of-client-component
 * pattern BoardTabsContainer uses. Past BookingRow JSX stays on the server
 * (server-first-react §4).
 *
 * The board polls every 2 s via router.refresh(). useState survives
 * router.refresh(), so the toggle state persists across polls — no special
 * handling needed (DEC-TF3).
 */

import { useState } from 'react';
import { ShowPastView } from '@/app/_components/ShowPastView/ShowPastView';

type ShowPastContainerProps = {
  /** How many past reservations are hidden (shown on collapsed label). */
  count: number;
  /** Server-rendered past BookingRow list — stays a server component. */
  children: React.ReactNode;
};

export function ShowPastContainer({ count, children }: ShowPastContainerProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <ShowPastView
      count={count}
      expanded={expanded}
      onToggle={() => setExpanded((prev) => !prev)}
    >
      {children}
    </ShowPastView>
  );
}
