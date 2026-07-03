// =============================================================================
// Root middleware — app-wide shared-password gate (DEC-AG1)
// =============================================================================
//
// Every request that reaches any route passes through here.  The gate reads
// the auth cookie and verifies its value via the Web Crypto derivation in
// lib/auth.ts.  If valid → let the request through.  If not → redirect to
// /login.
//
// COARSE GATE — not per-user auth.  There are no principals, no DB, no
// @core/iam or @core/auth.  DEC-P1 ("the Board has no user accounts") still
// holds inside the app.  This gate sits strictly above everything (DEC-AG1).
//
// EDGE-SAFE: lib/auth.ts uses Web Crypto only.  No DB, no ORM, no Node
// built-ins here (nexus-rules §6).
//
// FAIL-CLOSED (DEC-AG4): when APP_PASSWORD is unset, verifyCookieValue returns
// false → every request is redirected to /login.
// =============================================================================

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { AUTH_COOKIE, verifyCookieValue } from '@/lib/auth';

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const cookieValue = request.cookies.get(AUTH_COOKIE)?.value;
  const isValid = await verifyCookieValue(cookieValue);

  if (isValid) {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL('/login', request.url));
}

// Matcher: run on all app routes EXCEPT /login itself, Next.js internal paths,
// and static assets.  This prevents the redirect loop (AC-5) and avoids
// running the crypto check on every static file request.
export const config = {
  matcher: [
    /*
     * Match every path EXCEPT:
     *   /login          — the login screen itself (must be reachable unauthenticated)
     *   /_next/static   — Next.js compiled JS/CSS bundles
     *   /_next/image    — Next.js image optimisation endpoint
     *   /favicon.ico    — browser favicon request
     *   /.*\.(svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$ — static assets
     */
    '/((?!login|_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)',
  ],
};
