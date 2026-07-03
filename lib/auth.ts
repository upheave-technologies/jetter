// =============================================================================
// App-level auth helper — shared-password gate
// =============================================================================
//
// EDGE-SAFE: imports nothing from Node.js. Uses Web Crypto (globalThis.crypto
// .subtle) exclusively so this file is importable by middleware.ts which runs
// in the edge runtime.  No `next/headers`, no `fs`, no Node `crypto` module.
//
// Token derivation (DEC-AG5): the cookie value is a SHA-256 hex digest of:
//   APP_SALT + ":" + password
// where APP_SALT is a fixed app-string constant.  This makes the token:
//   a) deterministic given a password (middleware can recompute on every request)
//   b) non-forgeable without knowing the password
//   c) automatically invalidated when APP_PASSWORD is rotated
//
// Callers pass in the raw cookie value — this file never reads cookies itself,
// which keeps it caller-agnostic (middleware reads from request.cookies,
// loginAction reads via next/headers).
//
// Fail-closed (DEC-AG4): any function that needs APP_PASSWORD returns a
// "not configured" result when the env var is unset or empty.
// =============================================================================

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Name of the httpOnly auth cookie.  Referenced by middleware.ts and
 * app/login/actions.ts so the name stays in one place.
 */
export const AUTH_COOKIE = 'jet_auth';

/**
 * Fixed salt prefix mixed into the SHA-256 derivation.  Not a secret —
 * its purpose is namespace separation (i.e. a cookie from another app that
 * happens to use the same APP_PASSWORD will derive a different token).
 */
const APP_SALT = 'jet-reservation-board-v1';

// ---------------------------------------------------------------------------
// Token derivation
// ---------------------------------------------------------------------------

/**
 * Produces a deterministic, non-forgeable token from `password` using the
 * Web Crypto API (SHA-256).  Edge-safe.
 *
 * The input to the hash is:  APP_SALT + ":" + password
 * The output is a lowercase hex string.
 */
export async function deriveToken(password: string): Promise<string> {
  const input = `${APP_SALT}:${password}`;
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Expected token from the env var
// ---------------------------------------------------------------------------

/**
 * Returns the expected cookie token derived from the current APP_PASSWORD.
 *
 * Returns `null` when APP_PASSWORD is unset or empty (fail-closed, DEC-AG4).
 * Callers must treat a `null` return as "gate is locked, not configured."
 */
export async function expectedToken(): Promise<string | null> {
  const password = process.env.APP_PASSWORD;
  if (!password || password.trim() === '') return null;
  return deriveToken(password);
}

// ---------------------------------------------------------------------------
// Configuration guard
// ---------------------------------------------------------------------------

/**
 * Returns `true` iff APP_PASSWORD is set to a non-empty string.
 *
 * Callers use this to distinguish "gate misconfigured" from "wrong password"
 * without re-reading the env var themselves.  Centralises the predicate so no
 * other file reaches directly into process.env for this check (arch §1 —
 * encapsulation).
 *
 * Edge-safe: only reads `process.env`; no I/O, no Web Crypto, no Node APIs.
 */
export function isConfigured(): boolean {
  const p = process.env.APP_PASSWORD;
  return !!p && p.trim() !== '';
}

// ---------------------------------------------------------------------------
// Cookie verification
// ---------------------------------------------------------------------------

/**
 * Verifies that `value` (the raw cookie string) matches the expected token
 * derived from APP_PASSWORD.
 *
 * Returns `false` when:
 *   - APP_PASSWORD is unset or empty (fail-closed, DEC-AG4)
 *   - value is null / undefined / empty
 *   - value does not equal the expected token
 *
 * The comparison is done with a simple string equality after deriving both
 * sides.  The expected token is already a 64-char hex digest, so a matching
 * value must also be 64 chars — length mismatch is caught before character
 * comparison.  This is "constant-time-ish": JavaScript's string === comparison
 * is not guaranteed constant-time by the spec, but SHA-256 output comparison
 * is not a high-risk timing-oracle scenario for a shared-password gate with
 * no account lockout (see DEC-AG5 — the threat model is "keep strangers out,"
 * not "resist a remote timing attack").
 */
export async function verifyCookieValue(
  value: string | undefined | null,
): Promise<boolean> {
  if (!value) return false;

  const expected = await expectedToken();
  if (expected === null) return false; // APP_PASSWORD not configured → fail closed

  // Length check before comparison avoids trivial early-return on mismatched lengths.
  if (value.length !== expected.length) return false;

  return value === expected;
}

// ---------------------------------------------------------------------------
// Password verification (used by the login action)
// ---------------------------------------------------------------------------

/**
 * Returns `true` iff APP_PASSWORD is configured AND `candidate` equals it.
 *
 * This is the "did the user type the right password?" check.  The login
 * action calls this exactly once (the single decision call in its step 4).
 *
 * Returns `false` — never throws — when APP_PASSWORD is unset (DEC-AG4).
 */
export async function verifyPassword(candidate: string): Promise<boolean> {
  const expected = await expectedToken();
  if (expected === null) return false; // APP_PASSWORD not configured → fail closed

  const candidateToken = await deriveToken(candidate);

  // Length check before comparison catches trivial mismatches early.
  if (candidateToken.length !== expected.length) return false;
  return candidateToken === expected;
}
