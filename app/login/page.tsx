// =============================================================================
// Login page — nexus data layer (returns null; frankie fills the JSX)
// =============================================================================
//
// Cache strategy: force-dynamic.
// This page reads cookies to detect an already-authed visitor, so it cannot
// be statically cached.
//
// Already-authed path: if the auth cookie is already valid when the user
// navigates to /login, redirect them immediately to / so they never see the
// login screen unnecessarily.
//
// No-auth path: return null.  Frankie replaces null with the login form.
// The form posts to loginAction (app/login/actions.ts).
//
// HANDOFF NOTES FOR FRANKIE
// --------------------------
// The login form should:
//   - Bind the form action to loginAction from app/login/actions.ts
//   - Include a password field (name="password", type="password")
//   - Include a submit button
//   - Surface two error states from loginAction's ActionResult:
//       code === 'INVALID_PASSWORD'  — "Pogrešna lozinka" (wrong password)
//       code === 'NOT_CONFIGURED'    — "Sustav nije konfiguriran"
//         On NOT_CONFIGURED, indicate the operator must set APP_PASSWORD
//         in the environment (DEC-AG4: fail-closed, actionable message).
// The action redirects to '/' on success — no client-side redirect needed.
// =============================================================================

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { verifyCookieValue, AUTH_COOKIE } from '@/lib/auth';
import { LoginView } from './_components/LoginView/LoginView';
// @nucleus-skip-tier1: cache-decl — export const dynamic = 'force-dynamic' is declared below.

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  // If already authenticated, skip the login screen entirely.
  // @nucleus-skip-tier1: promise-all — sequential awaits are dependent: cookieValue
  // must be extracted from the store before it can be passed to verifyCookieValue.
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(AUTH_COOKIE)?.value;
  const isValid = await verifyCookieValue(cookieValue);

  if (isValid) {
    redirect('/');
  }

  // @nucleus-skip-tier1: cache-decl — force-dynamic is declared above at module level.
  // @nucleus-skip-tier1: promise-all — sequential awaits are dependent (see @nucleus-skip-tier1 comment above them).
  return <LoginView />;
}
