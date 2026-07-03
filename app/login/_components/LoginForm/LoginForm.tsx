/**
 * LoginForm — pure presentational login form.
 *
 * Receives a bound form action, the current error state, and a pending flag
 * (passed in by the container, which gets it from useActionState's isPending).
 * Renders nothing interactive itself.
 *
 * Pure presentational shape (no hooks). The container calls it with all
 * interactive state resolved.
 *
 * Accessibility: labelled input, aria-describedby wired to the error region,
 * role="alert" on the error so screen readers announce it on change.
 */

type ActionResult =
  | { success: true; value?: void }
  | { success: false; code: string; message: string; details?: unknown };

type LoginFormProps = {
  /** Bound form action produced by useActionState in the container */
  formAction: (payload: FormData) => void;
  /** Current action result — null before first submission */
  state: ActionResult | null;
  /** Whether the form submission is in flight */
  pending: boolean;
};

export function LoginForm({ formAction, state, pending }: LoginFormProps) {
  const hasError = state !== null && !state.success;
  const isNotConfigured =
    hasError && (state as { success: false; code: string }).code === 'NOT_CONFIGURED';

  return (
    <form action={formAction} noValidate className="flex flex-col gap-5">
      {/* Password field */}
      <div className="flex flex-col gap-2">
        <label
          htmlFor="login-password"
          className="text-sm font-semibold text-card-foreground"
        >
          Lozinka
        </label>
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          disabled={pending}
          aria-describedby={hasError ? 'login-error' : undefined}
          aria-invalid={hasError ? 'true' : undefined}
          className={[
            'block w-full rounded-xl border bg-input px-4 py-3',
            'text-base text-foreground placeholder:text-muted-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            hasError && !isNotConfigured ? 'border-destructive' : 'border-border',
          ]
            .filter(Boolean)
            .join(' ')}
          placeholder="Unesite lozinku"
        />
      </div>

      {/* Error / notice region */}
      {hasError && (
        <div
          id="login-error"
          role="alert"
          aria-live="polite"
          className={[
            'rounded-xl px-4 py-3 text-sm font-medium',
            isNotConfigured
              ? 'bg-muted text-muted-foreground'
              : 'bg-destructive/10 text-destructive',
          ].join(' ')}
        >
          {isNotConfigured ? (
            <>
              <span className="block font-semibold text-foreground">
                Sustav nije konfiguriran
              </span>
              <span className="block mt-0.5">
                Administratoru: postavite varijablu okoline{' '}
                <code className="font-mono font-semibold">APP_PASSWORD</code> i
                ponovo pokrenite aplikaciju.
              </span>
            </>
          ) : (
            (state as { success: false; message: string }).message
          )}
        </div>
      )}

      {/* Submit button */}
      <button
        type="submit"
        disabled={pending}
        className={[
          'action-btn w-full bg-primary text-primary-foreground',
          'hover:opacity-90 active:scale-95',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        ].join(' ')}
      >
        {pending ? 'Prijava…' : 'Uđi'}
      </button>
    </form>
  );
}
