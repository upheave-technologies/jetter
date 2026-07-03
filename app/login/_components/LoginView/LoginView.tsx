/**
 * LoginView — branding + layout shell for the login screen.
 *
 * Pure server component. Renders the full-page centered card with:
 *   - JetterLogo brand mark at the top
 *   - Heading + subtitle in Croatian
 *   - LoginFormContainer rendered directly (client interactive leaf)
 *
 * No state, no hooks, no data fetching. Props → JSX only.
 *
 * Design: coastal/marine tokens, forced light (no dark mode).
 * Touch targets: large card, generous padding for outdoor tablet use.
 */

import { JetterLogo } from '@/app/_components/JetterLogo/JetterLogo';
import { LoginFormContainer } from '@/app/login/_containers/LoginFormContainer';

export function LoginView() {
  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div
        className="w-full max-w-sm bg-card rounded-2xl shadow-card-md border border-border px-8 py-10 flex flex-col gap-8"
      >
        {/* Brand mark */}
        <div className="flex flex-col items-center gap-3">
          <JetterLogo className="text-primary text-2xl" />
          <div className="text-center">
            <h1 className="text-board-lg font-bold text-card-foreground leading-tight">
              Prijava
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Ploča rezervacija — samo ovlašteni pristup
            </p>
          </div>
        </div>

        {/* Interactive form — client leaf */}
        <LoginFormContainer />
      </div>
    </main>
  );
}
