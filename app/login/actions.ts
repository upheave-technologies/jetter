'use server';

// =============================================================================
// Login server action — shared-password gate entrypoint
// =============================================================================
//
// Five-step shape (server-actions.md §1):
//   1. Auth     — N/A: this IS the auth entrypoint; no prior session to check.
//   2. Extract  — password from FormData.
//   3. Validate — presence check; password must be present.
//   4. Decide   — verifyPassword() from lib/auth.ts (the single decision call).
//   5. Return / set cookie / redirect — on success set the auth cookie and
//      redirect('/'); on failure return a mapped ActionResult (never set the
//      cookie on failure, AC-3).
//
// Security notes (architecture.md §2, nexus-rules §8):
//   - The password is NEVER logged by value.
//   - On wrong password the response carries only a mapped code, not the
//     candidate value.
//   - APP_PASSWORD is read only inside lib/auth.ts (server-only env var).
// =============================================================================

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { log } from '@/packages/shared/observability';
import { verifyPassword, isConfigured, deriveToken, AUTH_COOKIE } from '@/lib/auth';
import { recordAuditEvent } from '@/modules/audit/application/recordAuditEventUseCase';
import type { AuditContext } from '@/modules/audit/domain/types';

// ---------------------------------------------------------------------------
// loginAuditContext — forensic request metadata for auth audit events (DEC-AU7)
// ---------------------------------------------------------------------------
// Local helper (mirrors auditContext in app/actions.ts; cannot be shared across
// sibling action files without a dedicated shared module).
// Security note (architecture.md §2): only ip + userAgent captured — never the
// candidate password value.
// ---------------------------------------------------------------------------

async function loginAuditContext(): Promise<AuditContext> {
  const h = await headers();
  const xff = h.get('x-forwarded-for');
  const ip = xff ? xff.split(',')[0]!.trim() : (h.get('x-real-ip') ?? undefined);
  const userAgent = h.get('user-agent') ?? undefined;
  return { actor: 'operator', ip, userAgent };
}

// ---------------------------------------------------------------------------
// ActionResult type — consistent with app/actions.ts shape
// ---------------------------------------------------------------------------

type ActionResult<T = void> =
  | { success: true; value?: T }
  | { success: false; code: string; message: string; details?: unknown };

// ---------------------------------------------------------------------------
// loginAction
// ---------------------------------------------------------------------------

const loginLog = log.child({ source: 'login.loginAction' });

export async function loginAction(
  formData: FormData,
): Promise<ActionResult> {
  loginLog.info('action.entered', { hasInput: !!formData });

  // 1. Auth — this IS the auth entrypoint; no session to verify here.

  // 2. Extract
  const password = formData.get('password') as string | null;

  // 3. Presence-validate
  if (!password) {
    loginLog.info('action.completed', { ok: false, code: 'VALIDATION_ERROR' });
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'Lozinka je obavezna',
    };
  }

  // 4. Call ONE decision: verifyPassword (reads APP_PASSWORD, derives token,
  //    compares — all inside lib/auth.ts; password value never logged here).
  const isValid = await verifyPassword(password);

  // 5. Return / set cookie / redirect
  if (!isValid) {
    // Distinguish: APP_PASSWORD unset (not configured) vs wrong password.
    // verifyPassword returns false for both; isConfigured() surfaces which.
    // The predicate lives in lib/auth.ts — not re-read from process.env here
    // (arch §1 — encapsulation; env access is centralized in lib/auth.ts).
    if (!isConfigured()) {
      loginLog.warn('action.completed', {
        ok: false,
        code: 'NOT_CONFIGURED',
      });
      // NOT_CONFIGURED: skip audit (no meaningful actor context; system is not
      // operational — auditing the absence of a password is noise, not signal).
      return {
        success: false,
        code: 'NOT_CONFIGURED',
        message: 'Sustav nije konfiguriran — postavite APP_PASSWORD',
      };
    }

    // DEC-AU7: record login_failure audit event (best-effort; fail-open per DEC-AU6).
    // NEVER log or store the candidate password value (architecture.md §2 / donnie-rules §8).
    // Awaited so the write completes before the response is returned — consistent with
    // the login_success path. recordAuditEvent is internally fail-open (catches and logs
    // on infra failure rather than throwing).
    await recordAuditEvent({
      entityType: 'auth',
      action: 'login_failure',
      entityId: null,
      summary: 'Neuspješna prijava',
      context: await loginAuditContext(),
    });

    loginLog.info('action.completed', { ok: false, code: 'INVALID_PASSWORD' });
    return {
      success: false,
      code: 'INVALID_PASSWORD',
      message: 'Pogrešna lozinka',
    };
  }

  // DEC-AU7: record login_success audit event BEFORE redirect() — redirect() throws
  // NEXT_REDIRECT so any await after it is unreachable. Fail-open per DEC-AU6.
  await recordAuditEvent({
    entityType: 'auth',
    action: 'login_success',
    entityId: null,
    summary: 'Prijava uspješna',
    context: await loginAuditContext(),
  });

  // Success: derive the token from the submitted password (same derivation as
  // verifyCookieValue uses in middleware) and store it in the httpOnly cookie.
  // Cookie flags (DEC-AG5):
  //   httpOnly    — not readable by JS in the browser
  //   sameSite    — lax (protects against CSRF on navigations)
  //   secure      — true in production; allows http in dev
  //   path        — /  (applies to all routes)
  //   maxAge      — 1 year (DEC-AG5: "stay logged in")
  const token = await deriveToken(password);
  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365, // 1 year in seconds
  });

  loginLog.info('action.completed', { ok: true });

  // Redirect to the board.  redirect() throws a Next.js NEXT_REDIRECT error
  // internally so no return value is reached after this point.
  redirect('/');
}
