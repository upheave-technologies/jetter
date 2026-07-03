'use client';

// =============================================================================
// BoardSyncContainer — 'use client' leaf
// =============================================================================
// Sets up a 2-second polling interval that calls router.refresh(), causing
// Next.js to re-fetch the page's server data in the background and update
// the UI without a full page reload (SPEC Decision #4, FSD §13 M-2 sync).
//
// This is the ONLY useEffect in the project and it is legitimate:
// it sets up a browser timer, not data fetching — server-first-react.md §3.
//
// Renders null — pure side effect leaf.
// =============================================================================

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const POLL_INTERVAL_MS = 2000;

/**
 * Invisible polling leaf. Mount once inside BoardView to keep every operator's
 * device in sync within ~2 seconds of any change (M-2 consistency).
 */
export function BoardSyncContainer() {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      router.refresh();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(id);
  }, [router]);

  return null;
}
