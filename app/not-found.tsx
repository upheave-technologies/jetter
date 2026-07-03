import Link from 'next/link';
import { Anchor, Home } from 'lucide-react';

// Rendered when notFound() is called anywhere under the root segment.
// Server component.

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-12 bg-background text-foreground">
      <div
        className="w-full max-w-sm rounded-2xl p-7 text-center bg-card border border-border shadow-card-md"
      >
        {/* Illustration moment — anchor icon in a muted circle */}
        <span className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-muted mb-4 mx-auto" aria-hidden="true">
          <Anchor className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
        </span>

        <p
          className="text-4xl font-extrabold mb-3 text-muted tabular-nums"
          aria-hidden="true"
        >
          404
        </p>
        <h1 className="text-xl font-bold mb-2 text-foreground">
          Stranica nije pronađena
        </h1>
        <p className="text-sm mb-6 text-muted-foreground">
          Ova stranica ne postoji. Vrati se na Ploču rezervacija.
        </p>
        <Link
          href="/"
          className="inline-flex items-center justify-center gap-2 rounded-xl px-6 py-4 w-full text-base font-bold bg-primary text-primary-foreground no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] transition-all min-h-13"
        >
          <Home className="h-4 w-4" aria-hidden="true" />
          Na Ploču rezervacija
        </Link>
      </div>
    </div>
  );
}
