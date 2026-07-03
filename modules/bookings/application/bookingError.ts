// =============================================================================
// Bookings Module — BookingError factory
// =============================================================================
// Provides a convenience factory for constructing BookingError objects.
// The type itself lives in domain/types.ts; this file wraps construction
// so callers can create errors with a single expression.
// =============================================================================

import type { BookingError } from '../domain/types';

/**
 * Creates a BookingError object.
 *
 * Usage:
 *   return { success: false, error: bookingErr('NOT_FOUND', `Booking ${id} not found`) };
 */
export function bookingErr(
  code: BookingError['code'],
  message: string,
  details?: unknown,
): BookingError {
  return details !== undefined
    ? { code, message, details }
    : { code, message };
}
