// =============================================================================
// Result Type — Generic Success/Failure Pattern
// =============================================================================
// A discriminated union type for handling success or failure without throwing
// exceptions. This is the foundation of error handling across all modules.
//
// Usage:
//   - Success: { success: true, value: T }
//   - Failure: { success: false, error: E }
//
// Type narrowing:
//   if (!result.success) {
//     // TypeScript knows result.error exists here
//     return result;
//   }
//   // TypeScript knows result.value exists here
//   const value = result.value;
// =============================================================================

export type Result<T, E = Error> =
  | { success: true; value: T }
  | { success: false; error: E };
