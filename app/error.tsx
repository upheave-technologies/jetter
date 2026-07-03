'use client';
// Next.js requires error boundaries to be client components — see
// page-architecture.md §5. This is the only file where 'use client' is
// permitted outside _containers/ (server-first-react.md §2).

import { CloudOff, RefreshCw } from 'lucide-react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-12 bg-background text-foreground">
      <div
        className="w-full max-w-sm rounded-2xl p-7 text-center bg-card border border-border shadow-card-md"
        role="alert"
      >
        {/* Icon — CloudOff, muted and large */}
        <span className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-destructive/10 mb-4 mx-auto" aria-hidden="true">
          <CloudOff className="h-7 w-7 text-destructive" aria-hidden="true" />
        </span>

        <h1 className="text-xl font-bold mb-2 text-foreground">
          Nešto je pošlo po krivu
        </h1>

        <p className="text-sm mb-1 text-muted-foreground">
          Ploča se nije mogla učitati. Obično se samo popravi — tapni dolje za
          ponovni pokušaj.
        </p>

        {error.digest && (
          <p className="text-xs font-mono mt-3 px-3 py-1.5 rounded-lg bg-muted text-muted-foreground inline-block">
            {error.digest}
          </p>
        )}

        <button
          onClick={reset}
          className="mt-5 w-full flex items-center justify-center gap-2 rounded-xl py-4 text-base font-bold bg-primary text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] transition-all min-h-13"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Pokušaj ponovo
        </button>
      </div>
    </div>
  );
}
