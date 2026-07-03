// =============================================================================
// Observability — AsyncLocalStorage Context Propagation
// =============================================================================
// log.withContext({ requestId, traceId, userId, tenantId }, fn) runs `fn` with
// those fields merged into every log record emitted within the async tree,
// including across await boundaries and nested withContext calls.
//
// Nested withContext: inner fields override outer fields key-by-key (shallow
// merge, inner wins).

import { AsyncLocalStorage } from 'node:async_hooks';

/** Fields that can be threaded through async context. */
export type LogContext = {
  requestId?: string;
  traceId?: string;
  spanId?: string;
  userId?: string;
  tenantId?: string;
  /** Additional arbitrary fields consumers may want to thread. */
  [key: string]: unknown;
};

/** Internal storage. One instance shared across the module. */
const storage = new AsyncLocalStorage<LogContext>();

/**
 * Run `fn` with `fields` merged into the ambient log context.
 * Nested calls: inner fields override outer per-key (shallow merge).
 * Context is restored to the outer value after `fn` completes.
 */
export function withContext<T>(fields: LogContext, fn: () => T): T {
  const outer = storage.getStore() ?? {};
  // Shallow merge: inner fields win
  const merged = { ...outer, ...fields };
  return storage.run(merged, fn);
}

/**
 * Returns the current ambient log context, or an empty object if none is set.
 * Called by the serialization layer to attach context fields to every record.
 */
export function getContext(): LogContext {
  return storage.getStore() ?? {};
}
